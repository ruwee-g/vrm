export type Channel = "dev" | "prerelease";

export const CHANNEL: Channel =
  import.meta.env.VITE_CHANNEL === "prerelease" ? "prerelease" : "dev";

export const IS_PRERELEASE = CHANNEL === "prerelease";
