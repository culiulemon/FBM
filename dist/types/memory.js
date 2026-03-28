export var MemoryType;
(function (MemoryType) {
    MemoryType["Knowledge"] = "knowledge";
    MemoryType["Experience"] = "experience";
    MemoryType["Preference"] = "preference";
    MemoryType["Event"] = "event";
    MemoryType["Project"] = "project";
    MemoryType["Custom"] = "custom";
})(MemoryType || (MemoryType = {}));
export const MEMORY_TYPE_DIRS = {
    [MemoryType.Knowledge]: 'knowledge',
    [MemoryType.Experience]: 'experience',
    [MemoryType.Preference]: 'preference',
    [MemoryType.Event]: 'event',
    [MemoryType.Project]: 'project',
    [MemoryType.Custom]: 'custom',
};
export const DEFAULT_MEMORY_TYPES = [
    MemoryType.Knowledge,
    MemoryType.Experience,
    MemoryType.Preference,
    MemoryType.Event,
    MemoryType.Project,
];
//# sourceMappingURL=memory.js.map