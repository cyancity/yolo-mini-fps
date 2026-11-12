# 第三方代码

本仓库自己的代码用 MIT 许可（见 [LICENSE](LICENSE)）。下面几段着色器函数的写法来自公开的第三方实现，原作者和许可列在这里。

| 内容 | 原作 | 许可 | 本仓库里的位置 |
|---|---|---|---|
| 9 次采样的 Catmull-Rom 纹理滤波 | Matt Pettineo (TheRealMJP)，`https://gist.github.com/TheRealMJP/c83b8c0f46b63f3a88a5986f4fa982b1` | MIT | `src/engine/post_taa.js` 的 `historyCatmullRom` |
| Minimal AgX 色调映射 | Copyright (c) 2024 Missing Deadlines (Benjamin Wrensch)，`https://iolite-engine.com/blog_posts/minimal_agx_implementation`。AgX 本身出自 Troy Sobotka | MIT | `src/engine/post_final.js` 的 `agxCurve`、`agx` |
| Hash without Sine | Copyright (c) 2014 David Hoskins，Shadertoy `4djSRW` | MIT | `src/engine/post_final.js` 的 `hash`，`src/fx/rain_splash.js` 的 `hash22`，`src/weapons/knife_gem.js` 的 `gemHash`、`gemHash2`，`src/world/ground.js` 的 `gHash`，`src/gfx/sky.js` 的 `hash`，`src/gfx/materials.js` 的 `pcHash` |
| 三维值噪声的 hash | Copyright (c) 2013 Inigo Quilez，Shadertoy `4sfGzS` | MIT | `src/engine/post_fog.js` 的 `hash3` |

下面几项没有许可上的要求，在这里致谢：

- Interleaved Gradient Noise：Jorge Jimenez，Next Generation Post Processing in Call of Duty: Advanced Warfare（SIGGRAPH 2014）。用在 `src/engine/glsl.js` 的 `ign` 和 `src/world/ground.js` 的 `gIgn`。
- PCG 哈希：Mark Jarzynski 和 Marc Olano，Hash Functions for GPU Rendering（JCGT 2020）；PCG 出自 Melissa O'Neill。用在 `src/gfx/texgen.js` 的 `pcg`。
- mulberry32：Tommy Ettinger，公有领域。用在 `src/world/labels.js`。

运行时依赖 three.js（MIT）和构建工具 Vite（MIT）通过 npm 安装，不在仓库里。外部素材的来源和许可见 [public/assets/README.md](public/assets/README.md)。

## MIT License

上表各项的版权归各自作者，许可文本如下。

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
