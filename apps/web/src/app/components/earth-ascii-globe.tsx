"use client";

import { useEffect, useRef } from "react";

type GlobePoint = {
  x: number;
  y: number;
  z: number;
  isLand: boolean;
};

const OCEAN_POINT_COUNT = 420;
const LAND_CLUSTER_COUNT = 8;
const LAND_POINTS_PER_CLUSTER = 32;

function randomSpherePoint(): { x: number; y: number; z: number } {
  const u = Math.random() * 2 - 1;
  const t = Math.random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);

  return {
    x: s * Math.cos(t),
    y: u,
    z: s * Math.sin(t),
  };
}

function createPoints(): GlobePoint[] {
  const points: GlobePoint[] = [];

  for (let i = 0; i < OCEAN_POINT_COUNT; i += 1) {
    const point = randomSpherePoint();
    points.push({ ...point, isLand: false });
  }

  const clusters: Array<{ x: number; y: number; z: number }> = [];
  for (let i = 0; i < LAND_CLUSTER_COUNT; i += 1) {
    clusters.push(randomSpherePoint());
  }

  for (const center of clusters) {
    for (let i = 0; i < LAND_POINTS_PER_CLUSTER; i += 1) {
      const spread = 0.18;
      const candidate = {
        x: center.x + (Math.random() * 2 - 1) * spread,
        y: center.y + (Math.random() * 2 - 1) * spread,
        z: center.z + (Math.random() * 2 - 1) * spread,
      };

      const magnitude = Math.hypot(candidate.x, candidate.y, candidate.z) || 1;
      points.push({
        x: candidate.x / magnitude,
        y: candidate.y / magnitude,
        z: candidate.z / magnitude,
        isLand: true,
      });
    }
  }

  return points;
}

export function EarthAsciiGlobe() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d", { alpha: true });
    if (!context) {
      return;
    }

    let rafId = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;

    const points = createPoints();
    let rotation = Math.random() * Math.PI * 2;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = () => {
      if (width <= 0 || height <= 0) {
        rafId = window.requestAnimationFrame(draw);
        return;
      }

      context.clearRect(0, 0, width, height);

      const gradient = context.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, "rgba(189, 225, 255, 0.08)");
      gradient.addColorStop(1, "rgba(58, 129, 214, 0.05)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);

      const radius = Math.min(width, height) * 0.32;
      const centerX = width * 0.74;
      const centerY = height * 0.5;
      const tilt = -0.35;

      const halo = context.createRadialGradient(
        centerX,
        centerY,
        radius * 0.8,
        centerX,
        centerY,
        radius * 1.55,
      );
      halo.addColorStop(0, "rgba(118, 196, 255, 0.13)");
      halo.addColorStop(1, "rgba(118, 196, 255, 0)");
      context.fillStyle = halo;
      context.beginPath();
      context.arc(centerX, centerY, radius * 1.6, 0, Math.PI * 2);
      context.fill();

      context.beginPath();
      context.strokeStyle = "rgba(188, 225, 255, 0.32)";
      context.lineWidth = 1;
      context.arc(centerX, centerY, radius + 6, 0, Math.PI * 2);
      context.stroke();

      const projected: Array<{ x: number; y: number; depth: number; isLand: boolean }> = [];

      for (const point of points) {
        const cosY = Math.cos(rotation);
        const sinY = Math.sin(rotation);

        const x1 = point.x * cosY + point.z * sinY;
        const z1 = -point.x * sinY + point.z * cosY;

        const cosX = Math.cos(tilt);
        const sinX = Math.sin(tilt);

        const y2 = point.y * cosX - z1 * sinX;
        const z2 = point.y * sinX + z1 * cosX;

        if (z2 < -0.16) {
          continue;
        }

        const perspective = 0.7 + z2 * 0.34;
        projected.push({
          x: centerX + x1 * radius * perspective,
          y: centerY + y2 * radius * perspective,
          depth: z2,
          isLand: point.isLand,
        });
      }

      projected.sort((a, b) => a.depth - b.depth);

      for (const point of projected) {
        const alpha = 0.3 + (point.depth + 1) * 0.35;
        const size = point.isLand ? 2.25 : 1.75;

        context.fillStyle = point.isLand
          ? `rgba(238, 250, 255, ${Math.min(0.96, alpha + 0.25)})`
          : `rgba(166, 214, 255, ${Math.min(0.82, alpha)})`;

        context.beginPath();
        context.arc(point.x, point.y, size, 0, Math.PI * 2);
        context.fill();
      }

      const barHeight = Math.max(30, height * 0.105);
      const barWidth = Math.min(width * 0.52, radius * 2.16);
      const barX = centerX - barWidth * 0.7;
      const barY = centerY - barHeight * 0.5;
      const barRadius = barHeight * 0.5;

      context.shadowColor = "rgba(33, 109, 184, 0.2)";
      context.shadowBlur = 16;
      context.fillStyle = "rgba(255, 255, 255, 0.95)";
      context.beginPath();
      context.moveTo(barX + barRadius, barY);
      context.lineTo(barX + barWidth - barRadius, barY);
      context.quadraticCurveTo(barX + barWidth, barY, barX + barWidth, barY + barRadius);
      context.lineTo(barX + barWidth, barY + barHeight - barRadius);
      context.quadraticCurveTo(barX + barWidth, barY + barHeight, barX + barWidth - barRadius, barY + barHeight);
      context.lineTo(barX + barRadius, barY + barHeight);
      context.quadraticCurveTo(barX, barY + barHeight, barX, barY + barHeight - barRadius);
      context.lineTo(barX, barY + barRadius);
      context.quadraticCurveTo(barX, barY, barX + barRadius, barY);
      context.fill();
      context.shadowBlur = 0;

      const iconRadius = barHeight * 0.26;
      const iconX = barX + barHeight * 0.6;
      const iconY = centerY;

      context.fillStyle = "rgba(63, 145, 226, 0.2)";
      context.beginPath();
      context.arc(iconX, iconY, iconRadius, 0, Math.PI * 2);
      context.fill();

      context.fillStyle = "rgba(44, 112, 188, 0.66)";
      context.beginPath();
      context.arc(iconX, iconY, iconRadius * 0.46, 0, Math.PI * 2);
      context.fill();

      context.font = `${Math.max(11, barHeight * 0.32)}px ${
        getComputedStyle(document.documentElement).getPropertyValue("--font-plex-mono") || "monospace"
      }`;
      context.textAlign = "right";
      context.textBaseline = "middle";
      context.fillStyle = "rgba(120, 140, 165, 0.95)";
      context.fillText("rf193,481.26", barX + barWidth - barHeight * 0.36, centerY + 0.5);

      rotation += 0.0036;
      rafId = window.requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    rafId = window.requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      window.cancelAnimationFrame(rafId);
    };
  }, []);

  return <canvas ref={canvasRef} className="hero-earth-canvas" aria-hidden="true" />;
}
