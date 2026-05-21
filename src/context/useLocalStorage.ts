import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from 'react';

const hasLocalStorage = typeof globalThis !== 'undefined' && typeof (globalThis as any).localStorage !== 'undefined';

export function useLocalStorage<T>(key: string, defaultState: T): [T, Dispatch<SetStateAction<T>>] {
    const state = useState<T>(() => {
        if (!hasLocalStorage) return defaultState;
        try {
            const value = (globalThis as any).localStorage.getItem(key);
            if (value) return JSON.parse(value) as T;
        } catch (error: any) {
            console.error(error);
        }
        return defaultState;
    });
    const value = state[0];

    const isFirstRenderRef = useRef(true);
    useEffect(() => {
        if (isFirstRenderRef.current) {
            isFirstRenderRef.current = false;
            return;
        }
        if (!hasLocalStorage) return;
        try {
            if (value === null) {
                (globalThis as any).localStorage.removeItem(key);
            } else {
                (globalThis as any).localStorage.setItem(key, JSON.stringify(value));
            }
        } catch (error: any) {
            console.error(error);
        }
    }, [value, key]);

    return state;
}
