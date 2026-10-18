import { type CredentialsLike, type Region } from "./types.js";
export interface ResolvedKeys {
    cn?: string;
    global?: string;
}
export declare function resolveKeys(credentials: CredentialsLike | undefined, env?: NodeJS.ProcessEnv): Promise<ResolvedKeys>;
export declare function configuredRegions(keys: ResolvedKeys): Region[];
//# sourceMappingURL=credentials.d.ts.map