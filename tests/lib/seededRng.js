// Minimal seedable PRNG (Mulberry32) - small and fast
module.exports = function seededRng(seed) {
    seed = seed >>> 0;
    return function () {
        seed += 0x6D2B79F5;
        var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
};
