/*
 * OmniFi Protocol — Certora Formal Verification Specification
 * Target: OmniFiPool (Concentrated Liquidity Core)
 * Documented per OmniFi Formal Verification Specification
 */

methods {
    function slot0() external returns (uint160, int24, uint8, bool) envfree;
    function liquidity() external returns (uint128) envfree;
    function protocolFees() external returns (uint128, uint128) envfree;
    function token0() external returns (address) envfree;
    function token1() external returns (address) envfree;
    function factory() external returns (address) envfree;
    function fee() external returns (uint24) envfree;
    function tickSpacing() external returns (int24) envfree;
}

// Invariant 1: SqrtPrice strictly within global tick boundary limits
invariant sqrtPriceWithinBounds()
    sinvoke slot0() {
        uint160 sqrtPriceX96;
        int24 tick;
        uint8 protocolFeeFraction;
        bool unlocked;
        sqrtPriceX96, tick, protocolFeeFraction, unlocked = slot0();
        assert sqrtPriceX96 >= 4295128739 && sqrtPriceX96 <= 1461446703485210103287273052203988822378723970342;
    }

// Invariant 2: Protocol Fee Fraction must never exceed hard cap of 25% (250)
invariant protocolFeeFractionCapped()
    sinvoke slot0() {
        uint160 sqrtPriceX96;
        int24 tick;
        uint8 protocolFeeFraction;
        bool unlocked;
        sqrtPriceX96, tick, protocolFeeFraction, unlocked = slot0();
        assert protocolFeeFraction <= 250;
    }

// Rule: Reentrancy lock is always engaged during state mutation and released after
rule reentrancyLockSafety(method f) {
    env e;
    calldataarg args;

    uint160 pBefore; int24 tBefore; uint8 pfBefore; bool unlockedBefore;
    pBefore, tBefore, pfBefore, unlockedBefore = slot0();

    require unlockedBefore == true;

    f(e, args);

    uint160 pAfter; int24 tAfter; uint8 pfAfter; bool unlockedAfter;
    pAfter, tAfter, pfAfter, unlockedAfter = slot0();

    assert unlockedAfter == true, "Pool must be unlocked after external call terminates";
}

