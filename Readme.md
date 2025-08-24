1. Change path according to your local in `package.json`
2. Switch between WebGPU and WebGL by changing the referencing script in `index.html`
3. Run

Notes:

Run Chromium GPU tests locally:

```
vpython3 ./content/test/gpu/run_gpu_integration_test.py pixel --no-skia-gold-failure --local-pixel-tests --passthrough --test-filter "*Pixel_WebGPUImportVideoFrameHDR*" --git-revision "27178a6c18c2dec98a725e194f87e1497fd96778"
```
