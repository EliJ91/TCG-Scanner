import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('public/vendor', { recursive: true });
await copyFile('node_modules/@techstark/opencv-js/dist/opencv.js', 'public/vendor/opencv.js');
await copyFile('node_modules/@techstark/opencv-js/LICENSE', 'public/vendor/OPENCV-LICENSE.txt').catch(() => {});
