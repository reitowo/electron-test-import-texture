/// <reference types="@types/offscreencanvas" />

export function logWithTime(message: string, ...optionalParams: any[]) {
    const date = new Date();
    const timestamp = `${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}.${date.getMilliseconds()}`;
    // console.log(`[${timestamp}] ${message}`, ...optionalParams);
}

// Create canvas and get WebGL context
const canvas = document.createElement("canvas");
canvas.width = 1280;
canvas.height = 720;
canvas.style.width = "1280px";
canvas.style.height = "720px";
document.body.appendChild(canvas);

const gl = canvas.getContext("webgl");
if (!gl) {
    throw new Error("WebGL not supported");
}

// Vertex Shader
const vsSource = `
  attribute vec4 aVertexPosition;
  attribute vec2 aTextureCoord;

  varying highp vec2 vTextureCoord;

  void main(void) {
    gl_Position = aVertexPosition;
    vTextureCoord = aTextureCoord;
  }
`;

// Fragment Shader
const fsSource = `
  varying highp vec2 vTextureCoord;
  uniform sampler2D uSampler;

  void main(void) {
    gl_FragColor = texture2D(uSampler, vTextureCoord);
  }
`;

// --- Shader Compilation and Linking ---
function loadShader(type: number, source: string): WebGLShader | null {
    const shader = gl!.createShader(type);
    if (!shader) return null;
    gl!.shaderSource(shader, source);
    gl!.compileShader(shader);
    if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
        console.error('An error occurred compiling the shaders: ' + gl!.getShaderInfoLog(shader));
        gl!.deleteShader(shader);
        return null;
    }
    return shader;
}

const vertexShader = loadShader(gl.VERTEX_SHADER, vsSource);
const fragmentShader = loadShader(gl.FRAGMENT_SHADER, fsSource);

const shaderProgram = gl.createProgram();
if (!shaderProgram || !vertexShader || !fragmentShader) {
    throw new Error("Failed to create shader program or shaders");
}
gl.attachShader(shaderProgram, vertexShader);
gl.attachShader(shaderProgram, fragmentShader);
gl.linkProgram(shaderProgram);

if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
    console.error('Unable to initialize the shader program: ' + gl.getProgramInfoLog(shaderProgram));
    throw new Error("Failed to link shader program");
}

// --- Get Shader Attribute and Uniform Locations ---
const programInfo = {
    program: shaderProgram,
    attribLocations: {
        vertexPosition: gl.getAttribLocation(shaderProgram, 'aVertexPosition'),
        textureCoord: gl.getAttribLocation(shaderProgram, 'aTextureCoord'),
    },
    uniformLocations: {
        uSampler: gl.getUniformLocation(shaderProgram, 'uSampler'),
    },
};

// --- Buffers ---
// Vertex positions (a quad covering the canvas)
const positionBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
const positions = [
    -1.0, 1.0,
    1.0, 1.0,
    -1.0, -1.0,
    1.0, -1.0,
];
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

// Texture coordinates
const textureCoordBuffer = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, textureCoordBuffer);
const textureCoordinates = [
    0.0, 0.0,
    1.0, 0.0,
    0.0, 1.0,
    1.0, 1.0,
];
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(textureCoordinates), gl.STATIC_DRAW);

// --- Texture ---
const texture = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, texture);
// Use placeholder pixel until first frame arrives
const level = 0;
const internalFormat = gl.RGBA;
const width = 1;
const height = 1;
const border = 0;
const srcFormat = gl.RGBA;
const srcType = gl.UNSIGNED_BYTE;
const pixel = new Uint8Array([0, 0, 255, 255]); // opaque blue
gl.texImage2D(gl.TEXTURE_2D, level, internalFormat,
    width, height, border, srcFormat, srcType,
    pixel);

// Set texture parameters for video frames
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);


// --- Render Function ---
(window as any).renderFrame = (frame: VideoFrame): void => {
    try {
        gl!.viewport(0, 0, gl!.canvas.width, gl!.canvas.height);
        gl!.clearColor(0.0, 0.0, 0.0, 1.0); // Clear to black
        gl!.clear(gl!.COLOR_BUFFER_BIT);

        // Upload VideoFrame to texture
        gl!.bindTexture(gl!.TEXTURE_2D, texture);
        gl!.texImage2D(
            gl!.TEXTURE_2D,    // target
            0,                // level
            gl!.RGBA,         // internalformat
            gl!.RGBA,         // format
            gl!.UNSIGNED_BYTE,// type
            frame             // pixelsource
        );

        // Tell WebGL to use our program
        gl!.useProgram(programInfo.program);

        // Set vertex positions attribute
        {
            const numComponents = 2;
            const type = gl!.FLOAT;
            const normalize = false;
            const stride = 0;
            const offset = 0;
            gl!.bindBuffer(gl!.ARRAY_BUFFER, positionBuffer);
            gl!.vertexAttribPointer(
                programInfo.attribLocations.vertexPosition,
                numComponents,
                type,
                normalize,
                stride,
                offset);
            gl!.enableVertexAttribArray(programInfo.attribLocations.vertexPosition);
        }

        // Set texture coordinates attribute
        {
            const numComponents = 2;
            const type = gl!.FLOAT;
            const normalize = false;
            const stride = 0;
            const offset = 0;
            gl!.bindBuffer(gl!.ARRAY_BUFFER, textureCoordBuffer);
            gl!.vertexAttribPointer(
                programInfo.attribLocations.textureCoord,
                numComponents,
                type,
                normalize,
                stride,
                offset);
            gl!.enableVertexAttribArray(programInfo.attribLocations.textureCoord);
        }

        // Specify the texture to map onto the faces.
        gl!.activeTexture(gl!.TEXTURE0);
        gl!.bindTexture(gl!.TEXTURE_2D, texture);
        // Tell the shader we bound the texture to texture unit 0
        gl!.uniform1i(programInfo.uniformLocations.uSampler, 0);

        // Draw the quad
        {
            const offset = 0;
            const vertexCount = 4;
            gl!.drawArrays(gl!.TRIANGLE_STRIP, offset, vertexCount);
        }
        console.log('WebGL Rendering complete');
    } catch (error) {
        console.error('WebGL Rendering error:', error);
    }
};

// @ts-ignore
(window as any).textures.onSharedTexture(async (id, imported) => {
    try {
        const frame = imported.getVideoFrame() as VideoFrame;
        logWithTime("rendering frame", id);
        (window as any).renderFrame(frame);
        logWithTime("frame closing", id)
        frame.close()
    } catch (error) {
        console.error("Error getting VideoFrame:", error);
    }
});
