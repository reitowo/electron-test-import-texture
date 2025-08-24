/// <reference types="@webgpu/types" />

import { webUtils } from "electron";
import { ipcRenderer } from "electron/renderer";

export function logWithTime(message: string, ...optionalParams: any[]) {
    const date = new Date();
    const timestamp = `${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}.${date.getMilliseconds()}`;
    // console.log(`[${timestamp}] ${message}`, ...optionalParams);
}

// Define grid size and canvas dimensions
const GRID_SIZE = 4; // 4x4 grid
const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const CELL_WIDTH = CANVAS_WIDTH / GRID_SIZE;
const CELL_HEIGHT = CANVAS_HEIGHT / GRID_SIZE;

// Create reusable resources to avoid recreating them every frame
const transformBuffers: GPUBuffer[] = [];
let pipeline: GPURenderPipeline | null = null;
let sampler: GPUSampler | null = null;
let fullScreenPipeline: GPURenderPipeline | null = null;
let fullScreenBindGroup: GPUBindGroup | null = null;

// Create a single WebGPU canvas
const canvas = document.createElement("canvas");
canvas.width = CANVAS_WIDTH;
canvas.height = CANVAS_HEIGHT;
canvas.style.width = `${CANVAS_WIDTH}px`;
canvas.style.height = `${CANVAS_HEIGHT}px`;
canvas.style.display = "block";
canvas.style.margin = "auto";
document.body.appendChild(canvas);

// WebGPU state
let device: GPUDevice;
let format: GPUTextureFormat;
let context: GPUCanvasContext;
let offscreenTexture: GPUTexture | null = null;
let offscreenTextureView: GPUTextureView | null = null;

// Full-screen quad shader (offscreenTexture -> canvas)
const getFullScreenShaderCode = () => `
    @group(0) @binding(0) var mySampler: sampler;
    @group(0) @binding(1) var myTexture: texture_2d<f32>;

    struct VertexOutput {
        @builtin(position) pos: vec4f,
        @location(0) uv: vec2f
    };

    @vertex
    fn vmain(@builtin(vertex_index) idx: u32) -> VertexOutput {
        var pos = array<vec2f, 6>(
            vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
            vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
        );
        var uv = array<vec2f, 6>(
            vec2f(0.0, 1.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0),
            vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(1.0, 0.0)
        );
        var out: VertexOutput;
        out.pos = vec4f(pos[idx], 0, 1);
        out.uv = uv[idx];
        return out;
    }

    @fragment
    fn fmain(in: VertexOutput) -> @location(0) vec4f {
        return textureSample(myTexture, mySampler, in.uv);
    }
`;

// Initialize WebGPU
const initWebGpu = async (): Promise<void> => {
    const adapter = await navigator.gpu.requestAdapter();
    device = await adapter!.requestDevice();
    format = "rgba16float";

    context = canvas.getContext("webgpu") as GPUCanvasContext;
    context.configure({
        device,
        format,
        //@ts-ignore
        colorSpace: 'srgb-linear',
        toneMapping: { mode: "extended" }
    });

    // 创建离屏渲染纹理
    offscreenTexture = device.createTexture({
        size: [CANVAS_WIDTH, CANVAS_HEIGHT],
        format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST
    });
    offscreenTextureView = offscreenTexture.createView();


    // Pre-create pipeline and sampler to avoid recreation every frame
    pipeline = await createRenderPipeline();
    sampler = device.createSampler({
        magFilter: 'linear',
        minFilter: 'linear',
        addressModeU: 'clamp-to-edge',
        addressModeV: 'clamp-to-edge'
    });

    // Full-screen pipeline for blitting offscreenTexture to canvas
    const fsModule = device.createShaderModule({ code: getFullScreenShaderCode() });
    const fsBindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        ]
    });
    const fsPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [fsBindGroupLayout] });
    fullScreenPipeline = device.createRenderPipeline({
        layout: fsPipelineLayout,
        vertex: { module: fsModule, entryPoint: "vmain" },
        fragment: { module: fsModule, entryPoint: "fmain", targets: [{ format }] },
        primitive: { topology: "triangle-list" }
    });
    // BindGroup 绑定离屏纹理
    fullScreenBindGroup = device.createBindGroup({
        layout: fsBindGroupLayout,
        entries: [
            { binding: 0, resource: sampler },
            { binding: 1, resource: offscreenTexture.createView() },
        ]
    });

    // Pre-allocate transform buffers for all grid cells
    for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
        transformBuffers[i] = device.createBuffer({
            size: 4 * 4, // 4 floats at 4 bytes each
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        // Pre-compute transform data for this cell
        const gridX = i % GRID_SIZE;
        const gridY = Math.floor(i / GRID_SIZE);
        const cellWidth = 2.0 / GRID_SIZE;
        const cellHeight = 2.0 / GRID_SIZE;
        const padding = 0.05;
        const effectiveWidth = cellWidth * (1.0 - padding);
        const effectiveHeight = cellHeight * (1.0 - padding);

        const transformData = new Float32Array([
            -1.0 + gridX * cellWidth + cellWidth / 2.0,
            1.0 - (gridY + 1) * cellHeight + cellHeight / 2.0,
            effectiveWidth / 2.0,
            effectiveHeight / 2.0
        ]);

        device.queue.writeBuffer(transformBuffers[i], 0, transformData);
    }

    console.log("WebGPU initialized successfully");
};

// Shader for rendering a grid of texture cells
const getGridShaderCode = () => {
    return `
        struct GridCellTransform {
            offsetX: f32,
            offsetY: f32,
            scaleX: f32,
            scaleY: f32,
        }
        
        @group(0) @binding(2) var<uniform> transform: GridCellTransform;

        struct VertexOutput {
            @builtin(position) position: vec4f,
            @location(0) texCoord: vec2f
        };

        @vertex
        fn vertexMain(
            @builtin(vertex_index) vertexIndex: u32
        ) -> VertexOutput {
            // Calculate vertices for a quad covering the current grid cell
            var pos: array<vec2f, 6> = array(
                vec2f(-1.0, -1.0),  // Bottom-left
                vec2f(1.0, -1.0),   // Bottom-right
                vec2f(-1.0, 1.0),   // Top-left
                vec2f(-1.0, 1.0),   // Top-left
                vec2f(1.0, -1.0),   // Bottom-right
                vec2f(1.0, 1.0)     // Top-right
            );
            
            // UV coordinates for texture mapping
            var uv: array<vec2f, 6> = array(
                vec2f(0.0, 1.0),
                vec2f(1.0, 1.0),
                vec2f(0.0, 0.0),
                vec2f(0.0, 0.0),
                vec2f(1.0, 1.0),
                vec2f(1.0, 0.0)
            );
            
            // Apply grid cell transform
            let transformedPos = vec2f(
                pos[vertexIndex].x * transform.scaleX + transform.offsetX,
                pos[vertexIndex].y * transform.scaleY + transform.offsetY
            );
            
            var output: VertexOutput;
            output.position = vec4f(transformedPos.x, transformedPos.y, 0.0, 1.0);
            output.texCoord = uv[vertexIndex];
            
            return output;
        }

        @group(0) @binding(0) var textureSampler: sampler;
        @group(0) @binding(1) var videoTexture: texture_external;

        @fragment
        fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
            return textureSampleBaseClampToEdge(
                videoTexture, 
                textureSampler, 
                input.texCoord
            );
        }
    `;
};

// Create render pipeline for grid rendering
const createRenderPipeline = async (): Promise<GPURenderPipeline> => {
    // Create bind group layout for the textures
    const bindGroupLayout = device.createBindGroupLayout({
        entries: [
            // Sampler binding
            {
                binding: 0,
                visibility: GPUShaderStage.FRAGMENT,
                sampler: {}
            },
            // External texture binding
            {
                binding: 1,
                visibility: GPUShaderStage.FRAGMENT,
                externalTexture: {}
            },
            // Uniform buffer for grid cell position
            {
                binding: 2,
                visibility: GPUShaderStage.VERTEX,
                buffer: {
                    type: "uniform"
                }
            }
        ]
    });

    // Create pipeline layout
    const pipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout]
    });

    // Create shader module
    const shaderModule = device.createShaderModule({
        code: getGridShaderCode()
    });

    // Create render pipeline
    return device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: {
            module: shaderModule,
            entryPoint: "vertexMain"
        },
        fragment: {
            module: shaderModule,
            entryPoint: "fragmentMain",
            targets: [{ format }]
        },
        primitive: {
            topology: "triangle-list"
        }
    });
};
// Store textures in renderer
const storedTextures: { id: string, idx: number, frame: VideoFrame, texture: GPUExternalTexture }[] = [];

// Render the grid with current textures
const renderGrid = async () => {
    if (!device || !context || !pipeline || !sampler || !offscreenTextureView) {
        console.warn("WebGPU not fully initialized yet");
        return;
    }

    if (storedTextures.length === 0) {
        return; // Nothing to render
    }

    try {
        // Use a map for faster lookups
        const textureMap = new Map<number, { texture: GPUExternalTexture, id: string, frame: VideoFrame }>();
        const releases = []

        // Process textures
        const keep = []
        for (const { id, idx, frame, texture } of storedTextures) {
            if (textureMap.has(idx)) {
                keep.push({ id, idx, frame, texture })
            } else {
                textureMap.set(idx, { texture, id, frame });
                releases.push(async () => {
                    frame.close();
                });
            }
        }

        // Clear the array but keep its capacity
        storedTextures.length = 0;
        storedTextures.push(...keep)

        if (textureMap.size === 0) {
            return; // No valid textures to render
        }

        // 1. 先渲染到离屏纹理
        if (!offscreenTexture) {
            console.warn("offscreenTexture not initialized");
            return;
        }
        const commandEncoder = device.createCommandEncoder();
        const renderPass = commandEncoder.beginRenderPass({
            colorAttachments: [
                {
                    view: offscreenTextureView,
                    loadOp: "load",
                    storeOp: "store",
                    clearValue: { r: 1, g: 1, b: 1, a: 1 }
                },
            ],
        });

        renderPass.setPipeline(pipeline);
        for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
            const textureData = textureMap.get(i);
            if (textureData) {
                const { texture } = textureData;
                const bindGroup = device.createBindGroup({
                    layout: pipeline.getBindGroupLayout(0),
                    entries: [
                        {
                            binding: 0,
                            resource: sampler
                        },
                        {
                            binding: 1,
                            resource: texture
                        },
                        {
                            binding: 2,
                            resource: { buffer: transformBuffers[i] }
                        }
                    ]
                });
                renderPass.setBindGroup(0, bindGroup);
                renderPass.draw(6, 1, 0, 0);
            }
        }
        renderPass.end();


        // 2. 渲染到canvas（full-screen quad）
        if (fullScreenPipeline && fullScreenBindGroup) {
            const canvasView = context.getCurrentTexture().createView();
            const pass = commandEncoder.beginRenderPass({
                colorAttachments: [
                    {
                        view: canvasView,
                        loadOp: "clear",
                        storeOp: "store",
                        clearValue: { r: 0, g: 0, b: 0, a: 1 }
                    }
                ]
            });
            pass.setPipeline(fullScreenPipeline);
            pass.setBindGroup(0, fullScreenBindGroup);
            pass.draw(6, 1, 0, 0);
            pass.end();
        }

        device.queue.submit([commandEncoder.finish()]);

        // Release frames efficiently after rendering is complete
        for (const release of releases) {
            await release();
        }
    } catch (error) {
        console.error("Error in renderGrid:", error);
    }
};

// Initialize WebGPU
initWebGpu().then(() => {
    console.log("WebGPU initialized, starting render loop");

    const renderLoop = () => {
        renderGrid();
        requestAnimationFrame(renderLoop);
    };

    // Start the render loop
    renderLoop();
}).catch(err => {
    console.error('Failed to initialize WebGPU:', err);
});

// Handle shared texture events
(window as any).textures.onSharedTexture(async (id: string, idx: number, imported: Electron.SharedTextureImported) => {
    const frame = imported.getVideoFrame() as VideoFrame;

    if (device) {
        const texture = device.importExternalTexture({
            source: frame,
            //@ts-ignore
            colorSpace: 'srgb-linear',
        }) as GPUExternalTexture;

        // Only store what we need for rendering
        storedTextures.push({ id, idx, frame, texture });
    } else {
        frame.close()
    }

    imported.release();
});

