import { defineNitroConfig } from "nitropack";

// https://nitro.unjs.io/reference/configuration
export default defineNitroConfig({
  preset: "vercel",
  externals: {
    external: [
      "https",
      "http",
      "http2",
      "zlib",
      "stream",
      "util",
      "buffer",
      "events",
      "path",
      "fs",
      "os",
      "crypto",
      "net",
      "tls",
      "url",
      "querystring",
      "string_decoder",
      "punycode",
      "process",
    ],
  },
  vite: {
    ssr: {
      external: [
        "https",
        "http",
        "http2",
        "zlib",
        "stream",
        "util",
        "buffer",
        "events",
        "path",
        "fs",
        "os",
        "crypto",
        "net",
        "tls",
        "url",
        "querystring",
        "string_decoder",
        "punycode",
        "process",
      ],
    },
  },
});
