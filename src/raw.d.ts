// vite 的 ?raw 导入：文件内容作为字符串打进产物。
declare module '*.swift?raw' {
    const content: string;
    export default content;
}
