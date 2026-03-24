export type XCredentials = {
  apiKey: string;
  apiKeySecret: string;
  accessToken: string;
  accessTokenSecret: string;
};

export const xCredStore: XCredentials = {
  apiKey: "",
  apiKeySecret: "",
  accessToken: "",
  accessTokenSecret: "",
};

export function isXConfigured(): boolean {
  return !!(
    xCredStore.apiKey &&
    xCredStore.apiKeySecret &&
    xCredStore.accessToken &&
    xCredStore.accessTokenSecret
  );
}
