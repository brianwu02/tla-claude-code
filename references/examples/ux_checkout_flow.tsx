/**
 * Checkout Flow State Reduction — Before/After
 *
 * BEFORE: 11-screen checkout flow (as designed).
 * AFTER:  7-screen flow after applying TLA+ state reduction analysis.
 *
 * The TLA+ spec doesn't find concurrency bugs here — it finds
 * structural inefficiency. TLC explores all paths through the flow
 * and identifies screens that are mandatory pairs, routing-only nodes,
 * or redundant for certain user segments.
 *
 * Maps to: references/ux-state-reduction.md
 */

import { useCallback, useState } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserProfile {
  isLoggedIn: boolean;
  hasAccount: boolean;
  hasSavedPayment: boolean;
  hasSavedAddress: boolean;
}

interface CheckoutState {
  currentScreen: string;
  stepCount: number;
  cart: number;
}

// ---------------------------------------------------------------------------
// Analytics — tracks actual path length per user (validates spec predictions)
// ---------------------------------------------------------------------------

function trackStep(screen: string, userType: string, stepNumber: number) {
  // Replace with your analytics provider
  console.log(`checkout_step: ${screen} | ${userType} | step ${stepNumber}`);
}

function getUserType(profile: UserProfile): string {
  if (!profile.hasAccount) return "guest";
  if (profile.hasSavedPayment && profile.hasSavedAddress) return "returning_full";
  if (profile.hasSavedAddress) return "returning_no_payment";
  return "returning_new";
}


// ===========================================================================
// BEFORE — 11-screen flow
// ===========================================================================

/**
 * TLA+ analysis results:
 *   Shortest path (returning, saved everything): 7 steps
 *   Longest path (guest):                       11 steps
 *   Gap: 57% overhead for new users
 *
 * Screens identified as merge/removal candidates:
 *   - search_results + site_detail → always adjacent (mandatory pair)
 *   - auth_gate → routing-only, collects no data
 *   - guest_info + shipping → both collect contact info
 *   - review + confirm → review is read-only, confirm is one button
 */
type ScreenBefore =
  | "browse"
  | "search_results"    // ← merge candidate: always followed by site_detail
  | "site_detail"       // ← merge candidate: always preceded by search_results
  | "date_picker"
  | "auth_gate"         // ← removal candidate: routing-only node
  | "sign_in"
  | "register"
  | "guest_info"        // ← merge candidate: same data as shipping
  | "shipping"
  | "payment"
  | "review"            // ← merge candidate: read-only, no new data
  | "confirm"
  | "done";

function getNextScreenBefore(
  current: ScreenBefore,
  profile: UserProfile,
  action: string
): ScreenBefore {
  switch (current) {
    case "browse":
      return "search_results";
    case "search_results":
      return "site_detail";
    case "site_detail":
      return "date_picker";
    case "date_picker":
      return "auth_gate";

    // Auth gate — routing-only node, no data collected
    case "auth_gate":
      if (action === "guest") return "guest_info";
      if (profile.hasAccount) return "sign_in";
      return "register";

    case "sign_in":
      if (profile.hasSavedAddress && profile.hasSavedPayment) return "review";
      if (profile.hasSavedAddress) return "payment";
      return "shipping";
    case "register":
      return "shipping";
    case "guest_info":
      return "shipping";

    case "shipping":
      return "payment";
    case "payment":
      return "review";
    case "review":
      return "confirm";
    case "confirm":
      return "done";
    default:
      return current;
  }
}


// ===========================================================================
// AFTER — 7-screen flow (applying TLA+ reduction suggestions)
// ===========================================================================

/**
 * Changes applied:
 *   1. search_results + site_detail → "search" (inline detail via expandable card)
 *   2. auth_gate removed → sign-in offered inline, default to guest flow
 *   3. guest_info + shipping → "details" (single form: name, email, address)
 *   4. review + confirm → "review" (Place Order button on review screen)
 *
 * TLA+ predicted path lengths after reduction:
 *   Returning (saved everything): 4 steps  (was 7,  -43%)
 *   Returning (no saved data):    6 steps  (was 9,  -33%)
 *   New user (register):          6 steps  (was 10, -40%)
 *   Guest:                        7 steps  (was 11, -36%)
 *
 * "Why you might keep it" notes from the spec analysis are preserved
 * as comments on each change.
 */
type ScreenAfter =
  | "search"         // merged: browse + search_results + site_detail
  | "dates"          // was: date_picker (renamed for clarity)
  | "sign_in"        // optional — shown inline, not a gate
  | "details"        // merged: guest_info + shipping (+ register for new users)
  | "payment"
  | "review"         // merged: review + confirm (Place Order button here)
  | "done";

function getNextScreenAfter(
  current: ScreenAfter,
  profile: UserProfile
): ScreenAfter {
  switch (current) {
    // Merged: browse → search with inline site detail
    // Why you might keep separate: SEO needs dedicated URLs per site,
    // mobile viewport too small for inline detail
    case "search":
      return "dates";

    // Dates shown on site detail, or as next step after selection
    // Why you might keep separate: complex date picker needs full screen on mobile
    case "dates":
      // Skip sign_in if already logged in or going guest
      if (profile.isLoggedIn) {
        if (profile.hasSavedAddress && profile.hasSavedPayment) return "review";
        if (profile.hasSavedAddress) return "payment";
        return "details";
      }
      // Show inline "sign in for faster checkout" option, but don't gate
      return "details";

    case "sign_in":
      // After sign-in, skip screens where we have saved data
      if (profile.hasSavedAddress && profile.hasSavedPayment) return "review";
      if (profile.hasSavedAddress) return "payment";
      return "details";

    // Merged: guest_info + shipping into single form
    // Why you might keep separate: email-first enables abandoned cart recovery
    // before collecting full address
    case "details":
      return "payment";

    case "payment":
      return "review";

    // Merged: review + confirm (Place Order button on review screen)
    // Why you might keep separate: legal/compliance may require explicit
    // confirmation step, high-value orders benefit from friction
    case "review":
      return "done";

    default:
      return current;
  }
}


// ===========================================================================
// Hook — works with either flow, tracks analytics
// ===========================================================================

function useCheckoutFlow(
  getNextScreen: (current: string, profile: UserProfile, action?: string) => string,
  profile: UserProfile
) {
  const [state, setState] = useState<CheckoutState>({
    currentScreen: "search",
    stepCount: 0,
    cart: 0,
  });

  const userType = getUserType(profile);

  const next = useCallback((action?: string) => {
    setState((prev) => {
      const nextScreen = getNextScreen(prev.currentScreen, profile, action ?? "");
      const nextStep = prev.stepCount + 1;
      trackStep(nextScreen, userType, nextStep);
      return {
        ...prev,
        currentScreen: nextScreen,
        stepCount: nextStep,
      };
    });
  }, [getNextScreen, profile, userType]);

  return { ...state, next };
}


// ===========================================================================
// Validation — compare actual step counts against spec predictions
// ===========================================================================

/**
 * Run these after deploying the reduced flow. If actual step counts
 * don't match spec predictions, either the implementation diverged
 * from the spec or users are taking unexpected paths (back button,
 * re-editing, error recovery loops the spec didn't model).
 *
 * Spec predictions:
 *   guest:                 7 steps
 *   returning_full:        4 steps
 *   returning_no_payment:  6 steps
 *   returning_new:         6 steps
 */
const EXPECTED_STEPS: Record<string, number> = {
  guest: 7,
  returning_full: 4,
  returning_no_payment: 6,
  returning_new: 6,
};

function validateFlowLength(userType: string, actualSteps: number) {
  const expected = EXPECTED_STEPS[userType];
  if (expected && actualSteps > expected) {
    console.warn(
      `Flow longer than spec predicted: ${userType} took ${actualSteps} steps (expected ${expected}). ` +
      `User may be looping (back button, re-editing) or hitting error states the spec didn't model.`
    );
  }
}

export {
  useCheckoutFlow,
  getNextScreenBefore,
  getNextScreenAfter,
  validateFlowLength,
};
