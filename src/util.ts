export const clamp = (v: number, a: number, b: number) =>
	v < a ? a : v > b ? b : v;

export const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
