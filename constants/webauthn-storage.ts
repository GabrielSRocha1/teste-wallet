const RP_NAME = 'Verum Wallet';
const CREDENTIAL_KEY = 'verum-webauthn-credential-id';
const USER_HANDLE_KEY = 'verum-webauthn-user-handle';

const hasWindow = (): boolean => typeof window !== 'undefined';

const toBase64Url = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (str: string): Uint8Array => {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = (str + pad).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

export const isWebAuthnSupported = (): boolean => {
  return hasWindow()
    && typeof window.PublicKeyCredential !== 'undefined'
    && !!navigator.credentials;
};

export const isPlatformAuthenticatorAvailable = async (): Promise<boolean> => {
  if (!isWebAuthnSupported()) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
};

export const getStoredCredentialId = (): string | null => {
  if (!hasWindow() || typeof localStorage === 'undefined') return null;
  return localStorage.getItem(CREDENTIAL_KEY);
};

const getOrCreateUserHandle = (): string => {
  let handle = localStorage.getItem(USER_HANDLE_KEY);
  if (!handle) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    handle = toBase64Url(bytes.buffer);
    localStorage.setItem(USER_HANDLE_KEY, handle);
  }
  return handle;
};

export const registerWebAuthnCredential = async (userName: string): Promise<boolean> => {
  if (!isWebAuthnSupported()) return false;

  const challenge = crypto.getRandomValues(new Uint8Array(32)) as BufferSource;
  const userHandle = fromBase64Url(getOrCreateUserHandle()) as BufferSource;

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: RP_NAME, id: window.location.hostname },
      user: {
        id: userHandle,
        name: userName || 'verum-user',
        displayName: userName || 'Verum User',
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'required',
        requireResidentKey: true,
      },
      timeout: 60000,
      attestation: 'none',
    },
  }) as PublicKeyCredential | null;

  if (!credential) return false;

  const credentialId = toBase64Url(credential.rawId);
  localStorage.setItem(CREDENTIAL_KEY, credentialId);
  return true;
};

export const authenticateWithWebAuthn = async (): Promise<boolean> => {
  if (!isWebAuthnSupported()) return false;

  const storedId = getStoredCredentialId();
  if (!storedId) return false;

  const challenge = crypto.getRandomValues(new Uint8Array(32)) as BufferSource;

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: window.location.hostname,
      allowCredentials: [{
        type: 'public-key',
        id: fromBase64Url(storedId) as BufferSource,
        transports: ['internal'],
      }],
      userVerification: 'required',
      timeout: 60000,
    },
  });

  return !!assertion;
};

export const clearWebAuthnCredential = (): void => {
  if (!hasWindow() || typeof localStorage === 'undefined') return;
  localStorage.removeItem(CREDENTIAL_KEY);
  localStorage.removeItem(USER_HANDLE_KEY);
};
