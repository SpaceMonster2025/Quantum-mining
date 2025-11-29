import { Entity, Point, Vector } from '../types';

export const distance = (p1: Point, p2: Point): number => {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
};

export const normalize = (v: Vector): Vector => {
  const mag = Math.sqrt(v.x * v.x + v.y * v.y);
  if (mag === 0) return { x: 0, y: 0 };
  return { x: v.x / mag, y: v.y / mag };
};

export const checkCollision = (e1: Entity, e2: Entity): boolean => {
  const dist = distance(e1, e2);
  return dist < e1.radius + e2.radius;
};

export const randomRange = (min: number, max: number): number => {
  return Math.random() * (max - min) + min;
};

export const rotatePoint = (p: Point, angle: number, origin: Point = { x: 0, y: 0 }): Point => {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  return {
    x: cos * dx - sin * dy + origin.x,
    y: sin * dx + cos * dy + origin.y
  };
};

export const generatePolygonOffsets = (vertexCount: number, variance: number): number[] => {
  const offsets = [];
  for (let i = 0; i < vertexCount; i++) {
    offsets.push(randomRange(1 - variance, 1 + variance));
  }
  return offsets;
};