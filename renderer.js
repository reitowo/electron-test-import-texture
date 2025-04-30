const { webUtils } = require("electron");
const { ipcRenderer } = require("electron/renderer");

// Import WebGPU utilities
const canvas = document.createElement("canvas");
document.body.appendChild(canvas);
canvas.width = 800;
canvas.height = 600;
const context = canvas.getContext("webgpu");
 
// 全局 WebGPU 变量
let device;
let format;
let renderPipeline; // 存储渲染管线

const initWebGpu = async () => {
  // Configure WebGPU context
  const adapter = await navigator.gpu.requestAdapter();
  device = await adapter.requestDevice();
  format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format });
  
  // 创建纹理的绑定组布局
  const bindGroupLayout = device.createBindGroupLayout({
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.FRAGMENT,
        texture: {
          sampleType: 'float',
          viewDimension: '2d',
        },
      },
    ],
  });

  // 创建管线布局
  const pipelineLayout = device.createPipelineLayout({
    bindGroupLayouts: [bindGroupLayout],
  });
  
  // 创建渲染管线（只需创建一次）
  renderPipeline = device.createRenderPipeline({
    layout: pipelineLayout,
    vertex: {
      module: device.createShaderModule({
        code: `
          @vertex
          fn main(@builtin(vertex_index) VertexIndex : u32) -> @builtin(position) vec4<f32> {
            var pos = array<vec2<f32>, 3>(
              vec2<f32>(-1.0, -1.0),
              vec2<f32>( 3.0, -1.0),
              vec2<f32>(-1.0,  3.0)
            );
            return vec4<f32>(pos[VertexIndex], 0.0, 1.0);
          }
        `,
      }),
      entryPoint: 'main',
    },
    fragment: {
      module: device.createShaderModule({
        code: `
          @group(0) @binding(0) var myTexture: texture_2d<f32>;
          @fragment
          fn main(@builtin(position) FragCoord: vec4<f32>) -> @location(0) vec4<f32> {
            return textureLoad(myTexture, vec2<i32>(FragCoord.xy), 0);
          }
        `,
      }),
      entryPoint: 'main',
      targets: [{ format }],
    },
    primitive: { topology: 'triangle-list' },
  });
};

// 初始化 WebGPU
initWebGpu().then(() => {
  console.log("WebGPU initialized with render pipeline");
});

ipcRenderer.on("shared-texture", async (_event, texture) => {
  if (!device || !renderPipeline) {
    console.error("WebGPU not fully initialized");
    return;
  }
  
  if (window.gpuPid === undefined) {
    return;
  }

  texture.handleOwnerProcess = process.pid;
  window.lastTexture = texture;
  console.log("Received shared texture:", texture);
  
  try {
    const gpuTexture = webUtils.importExternalSharedTextureToGpuDevice(device, texture);
    console.log("Imported GPU texture:", gpuTexture);

    // 渲染纹理到 canvas
    renderTexture(gpuTexture);
  } catch (error) {
    console.error("Error processing shared texture:", error);
  }
});

// 渲染纹理的函数
function renderTexture(gpuTexture) {
  // 创建纹理视图
  const textureView = gpuTexture.createView();
  
  // 创建绑定组（每次接收新纹理时需要更新）
  const bindGroup = device.createBindGroup({
    layout: renderPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: textureView }],
  });

  // 创建命令编码器和渲染通道
  const commandEncoder = device.createCommandEncoder();
  const canvasTextureView = context.getCurrentTexture().createView();
  const renderPass = commandEncoder.beginRenderPass({
    colorAttachments: [{
      view: canvasTextureView,
      loadOp: 'clear',
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      storeOp: 'store',
    }],
  });

  renderPass.setPipeline(renderPipeline);
  renderPass.setBindGroup(0, bindGroup);
  renderPass.draw(3);
  renderPass.end();

  // 提交命令
  device.queue.submit([commandEncoder.finish()]);
}
