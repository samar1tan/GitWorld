import { createLocalService } from '@gitworld/service';
import type { OperationProgress } from '@gitworld/contracts';
import type { FilePurpose } from './file-tokens.ts';
export type ServiceOptions = { dataDirectory: string; seedPackagePath: string; seedKnowledgeBundle?:{manifestPath:string;expectedManifestHash:string}; gitExecutable?: string; gitExecPath?: string; resolveFileToken: (token: string, purpose: FilePurpose) => string | undefined; onProgress: (progress: OperationProgress) => void };
export const SERVICE_IMPLEMENTED = true;
export const createService = (options: ServiceOptions) => createLocalService(options);
