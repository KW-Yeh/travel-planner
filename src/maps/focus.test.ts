import { describe, expect, it } from "vitest";
import { focusPoints } from "./focus";

const sight = (lat: number, lng: number) => ({ lat, lng, transport: false });
const station = (lat: number, lng: number) => ({ lat, lng, transport: true });

const kyotoStation = station(34.9858, 135.7588);
const inari = sight(34.9671, 135.7727);
const kiyomizu = sight(34.9949, 135.785);
const gion = sight(35.0037, 135.7788);
const arashiyama = sight(35.0094, 135.6668); // ~9 km west: a sight, so always framed
const kansaiAirport = station(34.4347, 135.244); // ~75 km away

describe("focusPoints", () => {
  it("drops a far-away airport so the city stops stay framed", () => {
    expect(focusPoints([kansaiAirport, kyotoStation, inari, kiyomizu, gion])).toEqual([kyotoStation, inari, kiyomizu, gion]);
  });

  it("never leaves out a sight, however far", () => {
    const farSight = sight(kansaiAirport.lat, kansaiAirport.lng);
    const day = [farSight, kyotoStation, inari, kiyomizu, gion];
    expect(focusPoints(day)).toEqual(day);
  });

  it("keeps a spread-out day within the same city", () => {
    const day = [kyotoStation, inari, kiyomizu, gion, arashiyama];
    expect(focusPoints(day)).toEqual(day);
  });

  it("keeps everything when there are too few places to tell what is far", () => {
    expect(focusPoints([kansaiAirport, kyotoStation])).toEqual([kansaiAirport, kyotoStation]);
    expect(focusPoints([kyotoStation])).toEqual([kyotoStation]);
  });

  it("keeps everything when the places split into two equal far-apart groups", () => {
    const osaka = sight(34.7025, 135.4959);
    const osaka2 = sight(34.6937, 135.5023);
    const points = [kyotoStation, inari, osaka, osaka2];
    expect(focusPoints(points)).toEqual(points);
  });
});
