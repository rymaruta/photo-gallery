import { describe, it, expect } from "vitest";
import { sanitizeCoords } from "../upload";

describe("sanitizeCoords", () => {
    it("有効な座標を約1km精度（小数第2位）に丸める", () => {
        expect(sanitizeCoords({ lat: 35.658644, lng: 139.745433 })).toEqual({ lat: 35.66, lng: 139.75 });
        expect(sanitizeCoords({ lat: -33.8688, lng: 151.2093 })).toEqual({ lat: -33.87, lng: 151.21 });
    });

    it("丸め済みの値はそのまま", () => {
        expect(sanitizeCoords({ lat: 35.66, lng: 139.75 })).toEqual({ lat: 35.66, lng: 139.75 });
    });

    it("数値以外・欠落は null", () => {
        expect(sanitizeCoords(undefined)).toBeNull();
        expect(sanitizeCoords(null)).toBeNull();
        expect(sanitizeCoords("35,139")).toBeNull();
        expect(sanitizeCoords({ lat: "35", lng: 139 })).toBeNull();
        expect(sanitizeCoords({ lat: 35 })).toBeNull();
        expect(sanitizeCoords({})).toBeNull();
    });

    it("NaN / Infinity は null", () => {
        expect(sanitizeCoords({ lat: NaN, lng: 139 })).toBeNull();
        expect(sanitizeCoords({ lat: 35, lng: Infinity })).toBeNull();
    });

    it("範囲外の座標は null", () => {
        expect(sanitizeCoords({ lat: 91, lng: 0 })).toBeNull();
        expect(sanitizeCoords({ lat: -91, lng: 0 })).toBeNull();
        expect(sanitizeCoords({ lat: 0, lng: 181 })).toBeNull();
        expect(sanitizeCoords({ lat: 0, lng: -181 })).toBeNull();
    });

    it("境界値（±90 / ±180）は有効", () => {
        expect(sanitizeCoords({ lat: 90, lng: 180 })).toEqual({ lat: 90, lng: 180 });
        expect(sanitizeCoords({ lat: -90, lng: -180 })).toEqual({ lat: -90, lng: -180 });
    });
});
