import { Adapter } from '@solana/wallet-adapter-base';

export enum Environment {
    MOBILE_WEB = 'MOBILE_WEB',
    DESKTOP_WEB = 'DESKTOP_WEB',
}

export function getEnvironment({
    adapters,
    userAgentString,
}: {
    adapters: Adapter[];
    userAgentString: string | null;
}): Environment {
    if (
        userAgentString &&
        (/android/i.test(userAgentString) || (/iPad|iPhone|iPod/.test(userAgentString) && !(globalThis as any).MSStream))
    ) {
        return Environment.MOBILE_WEB;
    }
    return Environment.DESKTOP_WEB;
}
