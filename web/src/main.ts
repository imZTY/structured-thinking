import './styles.css';
import { App } from './ui/app';

const mount = document.getElementById('app');
if (mount) {
  new App(mount);
}

// 仅生产构建注册：dev 下 SW 会缓存模块，干扰热更新
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}
