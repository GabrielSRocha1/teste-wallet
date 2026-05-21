import { Connection, type ConnectionConfig } from '@solana/web3.js';
import React, { createContext, useContext, useMemo, type ReactNode } from 'react';

export interface ConnectionContextState {
    connection: Connection;
}

export const ConnectionContext = createContext<ConnectionContextState>({} as ConnectionContextState);

export function useConnection(): ConnectionContextState {
    return useContext(ConnectionContext);
}

export interface ConnectionProviderProps {
    children: ReactNode;
    endpoint: string;
    config?: ConnectionConfig;
}

export const ConnectionProvider: React.FC<ConnectionProviderProps> = ({
    children,
    endpoint,
    config = { commitment: 'confirmed' },
}) => {
    const connection = useMemo(() => new Connection(endpoint, config), [endpoint, config]);
    return <ConnectionContext.Provider value={{ connection }}>{children}</ConnectionContext.Provider>;
};
