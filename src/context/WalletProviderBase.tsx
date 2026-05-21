import { Adapter, WalletError, WalletName } from '@solana/wallet-adapter-base';
import React, { createContext, FC, ReactNode, useContext, useMemo } from 'react';

export interface WalletContextState {
    wallets: any[];
    adapter: Adapter | null;
    isUnloadingRef: React.MutableRefObject<boolean>;
    onAutoConnectRequest: (() => Promise<void>) | undefined;
    onConnectError: () => void;
    onError?: (error: WalletError, adapter?: Adapter) => void;
    onSelectWallet: (walletName: WalletName | null) => void;
}

const WalletContext = createContext<WalletContextState>({} as WalletContextState);

export interface WalletProviderBaseProps {
    children: ReactNode;
    wallets: any[];
    adapter: Adapter | null;
    isUnloadingRef: React.MutableRefObject<boolean>;
    onAutoConnectRequest: (() => Promise<void>) | undefined;
    onConnectError: () => void;
    onError?: (error: WalletError, adapter?: Adapter) => void;
    onSelectWallet: (walletName: WalletName | null) => void;
}

export const WalletProviderBase: FC<WalletProviderBaseProps> = ({
    children,
    ...props
}) => {
    return <WalletContext.Provider value={props}>{children}</WalletContext.Provider>;
};

export function useWalletBase(): WalletContextState {
    return useContext(WalletContext);
}
