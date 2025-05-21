/// <reference types="@webgpu/types" />

import { webUtils } from "electron";
import { ipcRenderer } from "electron/renderer";

export function logWithTime(message: string, ...optionalParams: any[]) {
    const date = new Date();
    const timestamp = `${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}.${date.getMilliseconds()}`;
    // console.log(`[${timestamp}] ${message}`, ...optionalParams);
}

// 定义网格大小
const GRID_SIZE = 4; // 4x4网格
const CANVAS_WIDTH = 320; // 1280 / 4
const CANVAS_HEIGHT = 180; // 720 / 4

// 创建画布容器
const canvasContainer = document.createElement("div");
canvasContainer.style.display = "grid";
canvasContainer.style.gridTemplateColumns = `repeat(${GRID_SIZE}, ${CANVAS_WIDTH}px)`;
canvasContainer.style.gridTemplateRows = `repeat(${GRID_SIZE}, ${CANVAS_HEIGHT}px)`;
canvasContainer.style.gap = "2px";
canvasContainer.style.width = `${CANVAS_WIDTH * GRID_SIZE + (GRID_SIZE - 1) * 2}px`;
canvasContainer.style.height = `${CANVAS_HEIGHT * GRID_SIZE + (GRID_SIZE - 1) * 2}px`;
document.body.appendChild(canvasContainer);

// 创建画布和上下文数组
const canvases: HTMLCanvasElement[] = [];
const contexts: GPUCanvasContext[] = [];
const renderStates: { device: GPUDevice | null, format: GPUTextureFormat | null }[] = [];

// 初始化16个画布
for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    canvas.style.width = `${CANVAS_WIDTH}px`;
    canvas.style.height = `${CANVAS_HEIGHT}px`;
    canvas.id = `canvas-${i}`;
    
    canvasContainer.appendChild(canvas);
    canvases.push(canvas);
    
    const context = canvas.getContext("webgpu") as GPUCanvasContext;
    contexts.push(context);
    
    renderStates.push({ device: null, format: null });
}

const initWebGpu = async (): Promise<void> => {
    // 配置所有WebGPU上下文
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter!.requestDevice();
    const format = navigator.gpu.getPreferredCanvasFormat();
    
    // 初始化所有画布的WebGPU
    for (let i = 0; i < contexts.length; i++) {
        contexts[i].configure({ device, format });
        renderStates[i].device = device;
        renderStates[i].format = format;
    }

    (window as any).renderFrame = async (frame: VideoFrame, canvasIdx: number = 0): Promise<void> => {
        // 确保索引有效
        if (canvasIdx < 0 || canvasIdx >= contexts.length) {
            console.error(`Invalid canvas index: ${canvasIdx}`);
            return;
        }
        
        const context = contexts[canvasIdx];
        const { device, format } = renderStates[canvasIdx];
        
        if (!device || !format) {
            console.error(`WebGPU not initialized for canvas ${canvasIdx}`);
            return;
        }
        
        try {
            // 创建外部纹理
            const externalTexture = device.importExternalTexture({ source: frame });

            // 创建绑定组布局，正确指定外部纹理类型
            const bindGroupLayout = device.createBindGroupLayout({
                entries: [
                    {
                        binding: 0,
                        visibility: GPUShaderStage.FRAGMENT,
                        externalTexture: {}
                    },
                    {
                        binding: 1,
                        visibility: GPUShaderStage.FRAGMENT,
                        sampler: {}
                    }
                ]
            });

            // 创建管线布局
            const pipelineLayout = device.createPipelineLayout({
                bindGroupLayouts: [bindGroupLayout]
            });

            // 创建渲染管线
            const pipeline = device.createRenderPipeline({
                layout: pipelineLayout,
                vertex: {
                    module: device.createShaderModule({
                        code: `
                            @vertex
                            fn main(@builtin(vertex_index) VertexIndex : u32) -> @builtin(position) vec4<f32> {
                            var pos = array<vec2<f32>, 6>(
                                vec2<f32>(-1.0, -1.0),
                                vec2<f32>(1.0, -1.0),
                                vec2<f32>(-1.0, 1.0),
                                vec2<f32>(-1.0, 1.0),
                                vec2<f32>(1.0, -1.0),
                                vec2<f32>(1.0, 1.0)
                            );
                            return vec4<f32>(pos[VertexIndex], 0.0, 1.0);
                            }
                        `,
                    }),
                    entryPoint: "main",
                },
                fragment: {
                    module: device.createShaderModule({
                        code: `
                            @group(0) @binding(0) var extTex: texture_external;
                            @group(0) @binding(1) var mySampler: sampler;

                            @fragment
                            fn main(@builtin(position) fragCoord: vec4<f32>) -> @location(0) vec4<f32> {
                            let texCoord = fragCoord.xy / vec2<f32>(${CANVAS_WIDTH}.0, ${CANVAS_HEIGHT}.0);
                            return textureSampleBaseClampToEdge(extTex, mySampler, texCoord);
                            }
                        `,
                    }),
                    entryPoint: "main",
                    targets: [{ format }],
                },
                primitive: { topology: "triangle-list" },
            });

            // 创建绑定组
            const bindGroup = device.createBindGroup({
                layout: bindGroupLayout,
                entries: [
                    {
                        binding: 0,
                        resource: externalTexture
                    },
                    {
                        binding: 1,
                        resource: device.createSampler()
                    }
                ]
            });

            // 创建命令编码器和渲染通道
            const commandEncoder = device.createCommandEncoder();
            const textureView = context.getCurrentTexture().createView();
            const renderPass = commandEncoder.beginRenderPass({
                colorAttachments: [
                    {
                        view: textureView,
                        clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                        loadOp: "clear",
                        storeOp: "store",
                    },
                ],
            });

            // 设置管线和绑定组
            renderPass.setPipeline(pipeline);
            renderPass.setBindGroup(0, bindGroup);
            renderPass.draw(6); // 绘制由两个三角形组成的矩形
            renderPass.end();

            // 提交命令
            device.queue.submit([commandEncoder.finish()]);
        } catch (error) {
            console.error(`Rendering error on canvas ${canvasIdx}:`, error);
        }
    };
};

initWebGpu().catch(err => {
    console.error('Failed to initialize WebGPU:', err);
});

// @ts-ignore
(window as any).textures.onSharedTexture(async (id, idx, imported) => {
    try {
        // 使用idx来决定渲染到哪个画布上
        // 确保idx在有效范围内
        const canvasIdx = idx % (GRID_SIZE * GRID_SIZE);
        
        const frame = imported.getVideoFrame() as VideoFrame;
        logWithTime(`renderer rendering frame on canvas ${canvasIdx}`, id);

        await (window as any).renderFrame(frame, canvasIdx);
        logWithTime(`renderer frame closing for canvas ${canvasIdx}`, id);

        frame.close();
    } catch (error) {
        console.error("Error getting VideoFrame:", error);
    }
});