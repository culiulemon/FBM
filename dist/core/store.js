import { MemoryType, MEMORY_TYPE_DIRS, DEFAULT_MEMORY_TYPES } from '../types/memory.js';
import { mkdir, writeFile, readFile, unlink, readdir, stat, access } from 'node:fs/promises';
import { watch } from 'node:fs';
import { join, basename, extname } from 'node:path';
const INVALID_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;
const MAX_FILENAME_LEN = 200;
function sanitizeFileName(title) {
    let safe = title.replace(INVALID_CHARS, '_').trim().replace(/\.+$/, '');
    if (safe.length === 0)
        safe = 'untitled';
    if (safe.length > MAX_FILENAME_LEN)
        safe = safe.slice(0, MAX_FILENAME_LEN);
    if (!extname(safe).toLowerCase().endsWith('.md'))
        safe += '.md';
    return safe;
}
function getTypeDir(memoryDir, type) {
    return join(memoryDir, MEMORY_TYPE_DIRS[type]);
}
function getTypeFromDirName(dirName) {
    for (const [type, dir] of Object.entries(MEMORY_TYPE_DIRS)) {
        if (dir === dirName)
            return type;
    }
    return MemoryType.Custom;
}
export class MemoryStore {
    memoryDir;
    storeConfig;
    constructor(memoryDir, storeConfig) {
        this.memoryDir = memoryDir;
        this.storeConfig = storeConfig ?? {};
    }
    async init() {
        await mkdir(this.memoryDir, { recursive: true });
        const types = this.storeConfig.defaultMemoryTypes
            ? this.storeConfig.defaultMemoryTypes.map(t => t)
            : DEFAULT_MEMORY_TYPES;
        for (const type of types) {
            await mkdir(getTypeDir(this.memoryDir, type), { recursive: true });
        }
    }
    async write(doc) {
        const typeDir = getTypeDir(this.memoryDir, doc.type);
        await mkdir(typeDir, { recursive: true });
        let fileName = sanitizeFileName(doc.title);
        const filePath = join(typeDir, fileName);
        try {
            await access(filePath);
            const timestamp = Date.now();
            const nameWithoutExt = basename(fileName, '.md');
            fileName = sanitizeFileName(`${nameWithoutExt}_${timestamp}`);
        }
        catch {
            // file does not exist, use original name
        }
        const finalPath = join(typeDir, fileName);
        await writeFile(finalPath, doc.content, 'utf-8');
        return finalPath;
    }
    async read(options = {}) {
        if (options.path) {
            return this.readSingleFile(options.path);
        }
        const dirs = [];
        if (options.type) {
            dirs.push(getTypeDir(this.memoryDir, options.type));
        }
        else {
            const types = this.storeConfig.defaultMemoryTypes
                ? this.storeConfig.defaultMemoryTypes.map(t => t)
                : DEFAULT_MEMORY_TYPES;
            for (const type of types) {
                dirs.push(getTypeDir(this.memoryDir, type));
            }
        }
        const results = [];
        for (const dir of dirs) {
            let files;
            try {
                files = await readdir(dir);
            }
            catch {
                continue;
            }
            for (const file of files) {
                if (!file.endsWith('.md'))
                    continue;
                const filePath = join(dir, file);
                try {
                    const content = await readFile(filePath, 'utf-8');
                    const fileStat = await stat(filePath);
                    if (options.since !== undefined && fileStat.mtimeMs < options.since)
                        continue;
                    if (options.keyword && !content.toLowerCase().includes(options.keyword.toLowerCase()))
                        continue;
                    const dirName = basename(dir);
                    results.push({
                        type: getTypeFromDirName(dirName),
                        title: file.replace(/\.md$/, ''),
                        content,
                        filePath,
                        createdAt: fileStat.birthtimeMs,
                        updatedAt: fileStat.mtimeMs,
                    });
                }
                catch {
                    continue;
                }
            }
        }
        return results.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    async readSingleFile(filePath) {
        const content = await readFile(filePath, 'utf-8');
        const fileStat = await stat(filePath);
        const type = getTypeFromDirName(basename(join(filePath, '..')));
        return [{
                type,
                title: basename(filePath).replace(/\.md$/, ''),
                content,
                filePath,
                createdAt: fileStat.birthtimeMs,
                updatedAt: fileStat.mtimeMs,
            }];
    }
    async update(filePath, content) {
        await writeFile(filePath, content, 'utf-8');
    }
    async delete(filePath) {
        await unlink(filePath);
    }
    watch(callback) {
        if (this.storeConfig.watchFiles === false) {
            return () => { };
        }
        const watchers = [];
        const startWatch = (dir) => {
            try {
                const watcher = watch(dir, { recursive: true }, (eventType, filename) => {
                    if (!filename || !filename.endsWith('.md'))
                        return;
                    const fullPath = join(dir, filename);
                    if (eventType === 'rename') {
                        access(fullPath)
                            .then(() => callback('add', fullPath))
                            .catch(() => callback('unlink', fullPath));
                    }
                    else if (eventType === 'change') {
                        callback('change', fullPath);
                    }
                });
                watchers.push(watcher);
            }
            catch {
                // directory may not exist
            }
        };
        startWatch(this.memoryDir);
        return () => {
            for (const w of watchers) {
                w.close();
            }
            watchers.length = 0;
        };
    }
}
//# sourceMappingURL=store.js.map