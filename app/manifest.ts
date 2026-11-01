import type { MetadataRoute } from "next";

/** Lets a phone add the app to its home screen and open it without browser chrome. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CareerPilot AI",
    short_name: "CareerPilot",
    description: "Your AI career copilot — resume, jobs, applications, interviews.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0e17",
    theme_color: "#0a0e17",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
