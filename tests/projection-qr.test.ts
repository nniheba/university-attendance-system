import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const projectionSource = readFileSync(
  new URL("../components/teacher-projection.tsx", import.meta.url),
  "utf8",
);

describe("unified one-QR projection", () => {
  it("renders one authoritative dynamic attendance QR", () => {
    expect(projectionSource).toContain("`/api/sessions/${session.id}/qr`");
    expect(projectionSource).toContain("nextQrRefreshAt(frame)");
    expect(projectionSource).toContain("Registra tu asistencia");
    expect(projectionSource).toContain("Escanéalo con la cámara de tu móvil");
    expect(projectionSource).toContain("También puedes usar «Escanear asistencia»");
    expect(projectionSource.match(/<ProjectionQr frame=/gu)).toHaveLength(1);
  });

  it("removes the redundant static access QR", () => {
    expect(projectionSource).not.toContain("StaticAccessQr");
    expect(projectionSource).not.toContain("projectionAccessUrl");
    expect(projectionSource).not.toContain("Entra al sistema");
    expect(projectionSource).not.toContain("Escanea para abrir la plataforma");
  });

  it("keeps the single QR large, atomically preloaded and free from visible timers", () => {
    expect(projectionSource).toContain("w-[min(84vw,620px)]");
    expect(projectionSource).toContain("await preloadQrImage(imageDataUrl)");
    expect(projectionSource).toContain('dispatchQr({ type: "refresh-ready", frame })');
    expect(projectionSource).not.toContain("remainingSeconds");
    expect(projectionSource).not.toContain("qrProgress");
  });

  it("keeps the complete QR square and inside the available projection height", () => {
    const surface = projectionSource.slice(
      projectionSource.indexOf("function ProjectionQrSurface"),
    );

    expect(surface).toContain("aspect-square");
    expect(surface).toContain("max-w-full");
    expect(surface).toContain("overflow-visible");
    expect(surface).toContain("calc(100dvh-24rem)");
    expect(surface).not.toContain("overflow-hidden");
    expect(projectionSource).toContain('className="block size-full object-contain"');
    expect(projectionSource).toContain("lg:grid-rows-[auto_minmax(0,1fr)]");
    expect(projectionSource).toContain("lg:min-h-0");
  });

  it("stops the dynamic QR and shows a closed state after close", () => {
    expect(projectionSource).toContain('if (session.status !== "open")');
    expect(projectionSource).toContain('dispatchQr({ type: "reset" })');
    expect(projectionSource).toContain("<ProjectionClosed />");
    expect(projectionSource).toContain("Sesión cerrada");
  });

  it("does not expose private attendance evidence or raw destinations", () => {
    for (const privateField of [
      "teacher_note",
      "manual_reason",
      "student_email_snapshot",
      "gps_status",
      "network_city",
      "device_hash",
    ]) expect(projectionSource).not.toContain(privateField);
    expect(projectionSource).not.toContain("body.value}");
  });
});
