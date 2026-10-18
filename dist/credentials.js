import { CN_KEY_REF, GLOBAL_KEY_REF } from "./types.js";
export async function resolveKeys(credentials, env = process.env) {
    const [globalKey, cnKey] = await Promise.all([
        resolveOne(credentials, env, GLOBAL_KEY_REF),
        resolveOne(credentials, env, CN_KEY_REF),
    ]);
    const out = {};
    if (globalKey !== undefined)
        out.global = globalKey;
    if (cnKey !== undefined)
        out.cn = cnKey;
    return out;
}
export function configuredRegions(keys) {
    const regions = [];
    if (keys.global !== undefined)
        regions.push("global");
    if (keys.cn !== undefined)
        regions.push("cn");
    return regions;
}
async function resolveOne(credentials, env, name) {
    if (credentials !== undefined) {
        try {
            const hit = await credentials.resolve(name);
            const value = hit?.value;
            if (typeof value === "string" && value.length > 0)
                return value;
        }
        catch {
            // Fall through to the process environment.
        }
    }
    const ambient = env[name];
    if (typeof ambient === "string" && ambient.length > 0)
        return ambient;
    return undefined;
}
//# sourceMappingURL=credentials.js.map