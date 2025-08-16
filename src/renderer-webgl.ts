/// <reference types="@types/offscreencanvas" />

export function logWithTime(message: string, ...optionalParams: any[]) {
    const date = new Date();
    const timestamp = `${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}.${date.getMilliseconds()}`;
    // console.log(`[${timestamp}] ${message}`, ...optionalParams);
}

// Define grid size and canvas dimensions to match WebGPU version
const GRID_SIZE = 4; // 4x4 grid
const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const CELL_WIDTH = CANVAS_WIDTH / GRID_SIZE;
const CELL_HEIGHT = CANVAS_HEIGHT / GRID_SIZE;

// Create canvas and get WebGL context
const canvas = document.createElement("canvas");
canvas.width = CANVAS_WIDTH;
canvas.height = CANVAS_HEIGHT;
canvas.style.width = `${CANVAS_WIDTH}px`;
canvas.style.height = `${CANVAS_HEIGHT}px`;
canvas.style.display = "block";
canvas.style.margin = "auto";
document.body.appendChild(canvas);

const gl = canvas.getContext("webgl");
if (!gl) {
    throw new Error("WebGL not supported");
}

// Vertex Shader for grid rendering
const vsSource = `
  attribute vec4 aVertexPosition;
  attribute vec2 aTextureCoord;
  
  uniform vec4 uTransform; // offsetX, offsetY, scaleX, scaleY

  varying highp vec2 vTextureCoord;

  void main(void) {
    // Apply grid cell transform
    vec2 transformedPos = vec2(
      aVertexPosition.x * uTransform.z + uTransform.x,
      aVertexPosition.y * uTransform.w + uTransform.y
    );
    gl_Position = vec4(transformedPos.x, transformedPos.y, 0.0, 1.0);
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
        uTransform: gl.getUniformLocation(shaderProgram, 'uTransform'),
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

// --- Grid Transform Data ---
// Pre-compute transform data for all grid cells
const gridTransforms: Float32Array[] = [];
for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
    const gridX = i % GRID_SIZE;
    const gridY = Math.floor(i / GRID_SIZE);
    const cellWidth = 2.0 / GRID_SIZE;
    const cellHeight = 2.0 / GRID_SIZE;
    const padding = 0.05;
    const effectiveWidth = cellWidth * (1.0 - padding);
    const effectiveHeight = cellHeight * (1.0 - padding);

    const transformData = new Float32Array([
        -1.0 + gridX * cellWidth + cellWidth / 2.0,  // offsetX
        1.0 - (gridY + 1) * cellHeight + cellHeight / 2.0,  // offsetY
        effectiveWidth / 2.0,  // scaleX
        effectiveHeight / 2.0  // scaleY
    ]);
    
    gridTransforms[i] = transformData;
}

// --- Textures ---
// Store textures for grid rendering
const storedTextures: { id: string, idx: number, frame: VideoFrame, texture: WebGLTexture }[] = [];

// Create a placeholder texture
const createPlaceholderTexture = (): WebGLTexture => {
    const texture = gl.createTexture();
    if (!texture) throw new Error("Failed to create texture");
    
    gl.bindTexture(gl.TEXTURE_2D, texture);
    
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
    
    return texture;
};


// --- Grid Render Function ---
const renderGrid = (): void => {
    if (!gl || storedTextures.length === 0) {
        return; // Nothing to render
    }

    try {
        // Use a map for faster lookups
        const textureMap = new Map<number, { texture: WebGLTexture, id: string, frame: VideoFrame }>();
        const framesToClose: VideoFrame[] = [];

        // Process textures - keep only the latest texture for each grid position
        const keep: typeof storedTextures = [];
        for (const { id, idx, frame, texture } of storedTextures) {
            if (textureMap.has(idx)) {
                // Close the old frame
                const existing = textureMap.get(idx)!;
                framesToClose.push(existing.frame);
                // Delete the old texture
                gl.deleteTexture(existing.texture);
                keep.push({ id, idx, frame, texture });
            } else {
                textureMap.set(idx, { texture, id, frame });
            }
        }

        // Clear and update stored textures
        storedTextures.length = 0;
        storedTextures.push(...keep);

        if (textureMap.size === 0) {
            return; // No valid textures to render
        }

        // Set up WebGL state
        gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
        gl.clearColor(0.0, 0.0, 0.0, 1.0); // Clear to black
        gl.clear(gl.COLOR_BUFFER_BIT);

        // Tell WebGL to use our program
        gl.useProgram(programInfo.program);

        // Set up vertex attributes (once for all grid cells)
        // Set vertex positions attribute
        {
            const numComponents = 2;
            const type = gl.FLOAT;
            const normalize = false;
            const stride = 0;
            const offset = 0;
            gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
            gl.vertexAttribPointer(
                programInfo.attribLocations.vertexPosition,
                numComponents,
                type,
                normalize,
                stride,
                offset);
            gl.enableVertexAttribArray(programInfo.attribLocations.vertexPosition);
        }

        // Set texture coordinates attribute
        {
            const numComponents = 2;
            const type = gl.FLOAT;
            const normalize = false;
            const stride = 0;
            const offset = 0;
            gl.bindBuffer(gl.ARRAY_BUFFER, textureCoordBuffer);
            gl.vertexAttribPointer(
                programInfo.attribLocations.textureCoord,
                numComponents,
                type,
                normalize,
                stride,
                offset);
            gl.enableVertexAttribArray(programInfo.attribLocations.textureCoord);
        }

        // Render each texture in its grid cell
        for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
            const textureData = textureMap.get(i);
            if (textureData) {
                const { texture } = textureData;

                // Set grid cell transform
                gl.uniform4fv(programInfo.uniformLocations.uTransform, gridTransforms[i]);

                // Bind texture
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, texture);
                gl.uniform1i(programInfo.uniformLocations.uSampler, 0);

                // Draw the quad for this grid cell
                const offset = 0;
                const vertexCount = 4;
                gl.drawArrays(gl.TRIANGLE_STRIP, offset, vertexCount);
            }
        }

        // Close old frames
        for (const frame of framesToClose) {
            frame.close();
        }

    } catch (error) {
        console.error('WebGL Grid Rendering error:', error);
    }
};

// Start render loop
const renderLoop = () => {
    renderGrid();
    requestAnimationFrame(renderLoop);
};

// Start the render loop
renderLoop();

// Handle shared texture events - matches WebGPU version
(window as any).textures.onSharedTexture(async (id: string, idx: number, imported: Electron.SharedTextureImported) => {
    try {
        const frame = imported.getVideoFrame() as VideoFrame;
        imported.release();

        // Create WebGL texture from VideoFrame
        const texture = gl.createTexture();
        if (!texture) {
            console.error("Failed to create WebGL texture");
            frame.close();
            return;
        }

        gl.bindTexture(gl.TEXTURE_2D, texture);
        
        // Upload VideoFrame to texture
        gl.texImage2D(
            gl.TEXTURE_2D,    // target
            0,                // level
            gl.RGBA,          // internalformat
            gl.RGBA,          // format
            gl.UNSIGNED_BYTE, // type
            frame             // pixelsource
        );

        // Set texture parameters
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

        // Store texture for grid rendering
        storedTextures.push({ id, idx, frame, texture });

        logWithTime("WebGL texture created and stored", id, idx);
    } catch (error) {
        console.error("Error processing shared texture:", error);
    }
});