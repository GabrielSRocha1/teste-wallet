import { type Adapter, type WalletError, type WalletName } from '@solana/wallet-adapter-base';
import { useStandardWalletAdapters } from '@solana/wallet-standard-wallet-adapter-react';
import React, { type ReactNode, useCallback, useEffect, useMemo, useRef } from 'react';
import { useConnection } from './SolanaConnection';
import { useLocalStorage } from './useLocalStorage';
import { WalletProviderBase } from './WalletProviderBase';
import { VerumDeepLinkAdapter, VerumDeepLinkWalletName } from '../services/VerumDeepLinkAdapter';

export interface WalletProviderProps {
    children: ReactNode;
    wallets: Adapter[];
    autoConnect?: boolean | ((adapter: Adapter) => Promise<boolean>);
    localStorageKey?: string;
    onError?: (error: WalletError, adapter?: Adapter) => void;
}

export function WalletProvider({
    children,
    wallets: adapters,
    autoConnect,
    localStorageKey = 'walletName',
    onError,
}: WalletProviderProps) {
    useConnection(); // mantém compat: garante que o ConnectionProvider local está montado acima
    const adaptersWithStandardAdapters = useStandardWalletAdapters(adapters);

    const verumAdapter = useMemo(() => new VerumDeepLinkAdapter(), []);

    const allAdapters = useMemo(() => {
        const hasVerum = adaptersWithStandardAdapters.some((a: Adapter) => a.name === VerumDeepLinkWalletName);
        return hasVerum ? adaptersWithStandardAdapters : [verumAdapter, ...adaptersWithStandardAdapters];
    }, [adaptersWithStandardAdapters, verumAdapter]);

    const [walletName, setWalletName] = useLocalStorage<WalletName | null>(localStorageKey, null);
    const adapter = useMemo(
        () => allAdapters.find((a: Adapter) => a.name === walletName) ?? null,
        [allAdapters, walletName]
    );

    const changeWallet = useCallback(
        (nextWalletName: WalletName<string> | null) => {
            if (walletName === nextWalletName) return;
            if (adapter) {
                adapter.disconnect();
            }
            setWalletName(nextWalletName);
        },
        [adapter, setWalletName, walletName]
    );

    const isUnloadingRef = useRef(false);

    useEffect(() => {
        if (!adapter) return;
        function handleDisconnect() {
            if (isUnloadingRef.current) return;
            setWalletName(null);
        }
        adapter.on('disconnect', handleDisconnect);
        return () => {
            adapter.off('disconnect', handleDisconnect);
        };
    }, [adapter, setWalletName]);

    const hasUserSelectedAWallet = useRef(false);
    const handleAutoConnectRequest = useMemo(() => {
        if (!autoConnect || !adapter) return;
        return async () => {
            if (autoConnect === true || (await autoConnect(adapter))) {
                if (hasUserSelectedAWallet.current) {
                    await adapter.connect();
                } else {
                    await adapter.autoConnect();
                }
            }
        };
    }, [autoConnect, adapter]);

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
        function handleBeforeUnload() {
            isUnloadingRef.current = true;
        }
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload);
        };
    }, []);

    const handleConnectError = useCallback(() => {
        if (adapter) {
            changeWallet(null);
        }
    }, [adapter, changeWallet]);

    const selectWallet = useCallback(
        (walletName: WalletName | null) => {
            hasUserSelectedAWallet.current = true;
            changeWallet(walletName);
        },
        [changeWallet]
    );

    return (
        <WalletProviderBase
            wallets={allAdapters}
            adapter={adapter}
            isUnloadingRef={isUnloadingRef}
            onAutoConnectRequest={handleAutoConnectRequest}
            onConnectError={handleConnectError}
            onError={onError}
            onSelectWallet={selectWallet}
        >
            {children}
        </WalletProviderBase>
    );
}
