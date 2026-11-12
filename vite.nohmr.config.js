// 验收用：关掉热更新，页面不会因为别处保存文件而自己刷新
import { defineConfig } from 'vite';

export default defineConfig({ server: { hmr: false } });
