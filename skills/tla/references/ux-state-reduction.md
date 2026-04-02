# Worked Example: UX Flow State Reduction

Use TLA+ to model a user's path through a multi-step flow (checkout, onboarding, booking), count the states they must traverse, and identify simplification opportunities through reductive analysis of the spec.

This isn't about concurrency bugs — it's about using formal state exploration to answer: **"What is the minimum number of steps a user needs to reach their goal, and which steps are candidates for removal or merging?"**

TLC exhaustively explores every path through your flow. States that every successful path must visit are load-bearing. States that only some paths visit are candidates for simplification. States that create loops or dead ends are UX bugs.

## The Design

> A user wants to book a campsite. They search, select a site, pick dates, optionally create an account, enter payment, review, and confirm. Some users are returning (have saved payment), some are guests, some abandon mid-flow.

### The flow as designed

```
Browse → Search Results → Site Detail → Date Picker → Auth Gate →
  ├── Guest Checkout → Shipping → Payment → Review → Confirm → Done
  └── Sign In/Register → Shipping → Payment → Review → Confirm → Done
                                                  ↑
                           (returning user: skip shipping + payment if saved)
```

The product team designed 11 distinct screens. The question is: does the user actually need all 11?

---

## The Spec

```tla
--------------------------- MODULE CheckoutFlow ---------------------------
EXTENDS Naturals, FiniteSets

CONSTANTS NULL

VARIABLES screen,           \* Current screen the user sees
          cart,             \* Set of items in cart (simplified to count)
          hasAccount,       \* User has an account
          isLoggedIn,       \* User is currently logged in
          hasSavedPayment,  \* User has payment on file
          hasSavedAddress,  \* User has shipping address on file
          orderPlaced       \* Terminal state: order complete

vars == <<screen, cart, hasAccount, isLoggedIn,
          hasSavedPayment, hasSavedAddress, orderPlaced>>

Screens == {
    "browse", "search_results", "site_detail", "date_picker",
    "auth_gate", "sign_in", "register", "guest_info",
    "shipping", "payment", "review", "confirm", "done", "abandoned"
}

\* ---------- Type invariant ----------
TypeOK ==
    /\ screen \in Screens
    /\ cart \in 0..3
    /\ hasAccount \in BOOLEAN
    /\ isLoggedIn \in BOOLEAN
    /\ hasSavedPayment \in BOOLEAN
    /\ hasSavedAddress \in BOOLEAN
    /\ orderPlaced \in BOOLEAN

\* ---------- Init ----------
\* Model different user types via nondeterministic init
Init ==
    /\ screen = "browse"
    /\ cart = 0
    /\ hasAccount \in {TRUE, FALSE}       \* TLC explores both
    /\ isLoggedIn = FALSE
    /\ hasSavedPayment \in {TRUE, FALSE}  \* TLC explores both
    /\ hasSavedAddress \in {TRUE, FALSE}
    /\ orderPlaced = FALSE

\* ====================================================================
\* User actions — each models one screen transition
\* ====================================================================

Search ==
    /\ screen = "browse"
    /\ screen' = "search_results"
    /\ UNCHANGED <<cart, hasAccount, isLoggedIn,
                   hasSavedPayment, hasSavedAddress, orderPlaced>>

ViewSite ==
    /\ screen = "search_results"
    /\ screen' = "site_detail"
    /\ UNCHANGED <<cart, hasAccount, isLoggedIn,
                   hasSavedPayment, hasSavedAddress, orderPlaced>>

AddToCart ==
    /\ screen = "site_detail"
    /\ cart < 3
    /\ cart' = cart + 1
    /\ screen' = "date_picker"
    /\ UNCHANGED <<hasAccount, isLoggedIn,
                   hasSavedPayment, hasSavedAddress, orderPlaced>>

PickDates ==
    /\ screen = "date_picker"
    /\ cart > 0
    /\ screen' = "auth_gate"
    /\ UNCHANGED <<cart, hasAccount, isLoggedIn,
                   hasSavedPayment, hasSavedAddress, orderPlaced>>

\* --- Auth gate: routes based on user type ---

ChooseGuest ==
    /\ screen = "auth_gate"
    /\ screen' = "guest_info"
    /\ UNCHANGED <<cart, hasAccount, isLoggedIn,
                   hasSavedPayment, hasSavedAddress, orderPlaced>>

ChooseSignIn ==
    /\ screen = "auth_gate"
    /\ hasAccount
    /\ screen' = "sign_in"
    /\ UNCHANGED <<cart, hasAccount, isLoggedIn,
                   hasSavedPayment, hasSavedAddress, orderPlaced>>

ChooseRegister ==
    /\ screen = "auth_gate"
    /\ ~hasAccount
    /\ screen' = "register"
    /\ UNCHANGED <<cart, hasAccount, isLoggedIn,
                   hasSavedPayment, hasSavedAddress, orderPlaced>>

SignIn ==
    /\ screen = "sign_in"
    /\ isLoggedIn' = TRUE
    /\ screen' = IF hasSavedAddress THEN
                    IF hasSavedPayment THEN "review"    \* skip shipping + payment
                    ELSE "payment"                       \* skip shipping only
                 ELSE "shipping"
    /\ UNCHANGED <<cart, hasAccount, hasSavedPayment, hasSavedAddress, orderPlaced>>

Register ==
    /\ screen = "register"
    /\ hasAccount' = TRUE
    /\ isLoggedIn' = TRUE
    /\ screen' = "shipping"
    /\ UNCHANGED <<cart, hasSavedPayment, hasSavedAddress, orderPlaced>>

EnterGuestInfo ==
    /\ screen = "guest_info"
    /\ screen' = "shipping"
    /\ UNCHANGED <<cart, hasAccount, isLoggedIn,
                   hasSavedPayment, hasSavedAddress, orderPlaced>>

EnterShipping ==
    /\ screen = "shipping"
    /\ screen' = "payment"
    /\ hasSavedAddress' = TRUE
    /\ UNCHANGED <<cart, hasAccount, isLoggedIn, hasSavedPayment, orderPlaced>>

EnterPayment ==
    /\ screen = "payment"
    /\ screen' = "review"
    /\ hasSavedPayment' = TRUE
    /\ UNCHANGED <<cart, hasAccount, isLoggedIn, hasSavedAddress, orderPlaced>>

ReviewOrder ==
    /\ screen = "review"
    /\ cart > 0
    /\ screen' = "confirm"
    /\ UNCHANGED <<cart, hasAccount, isLoggedIn,
                   hasSavedPayment, hasSavedAddress, orderPlaced>>

ConfirmOrder ==
    /\ screen = "confirm"
    /\ orderPlaced' = TRUE
    /\ screen' = "done"
    /\ UNCHANGED <<cart, hasAccount, isLoggedIn,
                   hasSavedPayment, hasSavedAddress>>

\* --- Abandon: user can leave at any point before confirming ---
Abandon ==
    /\ screen \notin {"done", "abandoned"}
    /\ screen' = "abandoned"
    /\ UNCHANGED <<cart, hasAccount, isLoggedIn,
                   hasSavedPayment, hasSavedAddress, orderPlaced>>

Next ==
    \/ Search \/ ViewSite \/ AddToCart \/ PickDates
    \/ ChooseGuest \/ ChooseSignIn \/ ChooseRegister
    \/ SignIn \/ Register \/ EnterGuestInfo
    \/ EnterShipping \/ EnterPayment
    \/ ReviewOrder \/ ConfirmOrder
    \/ Abandon

\* ====================================================================
\* Properties
\* ====================================================================

\* SAFETY: If order is placed, cart was non-empty
NoEmptyOrder ==
    orderPlaced => cart > 0

\* SAFETY: Done means order was placed
DoneImpliesPlaced ==
    screen = "done" => orderPlaced

\* LIVENESS: every non-abandoned path can eventually reach "done"
\* (under fairness — user keeps moving forward)
CanComplete == <>(screen = "done" \/ screen = "abandoned")

\* ====================================================================
\* Analysis helpers — these are NOT correctness properties.
\* They help count paths and identify optimization targets.
\* ====================================================================

\* REACHABILITY: which screens are actually visited?
\* (Check TLC coverage stats after run)

\* PATH LENGTH: instrument with a step counter
\* (See MC module below)

Spec == Init /\ [][Next]_vars /\ WF_vars(Next)
=============================================================================
```

## MC Module — with path length instrumentation

```tla
----------------------- MODULE MC_CheckoutFlow -----------------------
EXTENDS CheckoutFlow, Naturals

MC_NULL == "null_val"

\* Add a step counter to measure path lengths
VARIABLES stepCount

mcVars == <<screen, cart, hasAccount, isLoggedIn,
            hasSavedPayment, hasSavedAddress, orderPlaced, stepCount>>

MCInit ==
    /\ Init
    /\ stepCount = 0

MCNext ==
    /\ Next
    /\ stepCount' = stepCount + 1

\* Bound exploration
StateConstraint ==
    /\ stepCount <= 15
    /\ cart <= 2

\* Find the shortest path to "done" by making this an invariant.
\* TLC will produce a counterexample — the trace IS the shortest path.
NotDone == screen # "done"
=============================================================================
```

## MC Config

```
SPECIFICATION Spec
CONSTANTS
    NULL = "null_val"
INVARIANT TypeOK
INVARIANT NoEmptyOrder
INVARIANT DoneImpliesPlaced
INVARIANT NotDone
CONSTRAINT StateConstraint
```

---

## What TLC Finds

### Path analysis

Use the `NotDone` invariant trick: TLC finds the **shortest counterexample** — which is the shortest path to `screen = "done"`.

**Shortest path (returning user with saved payment + address): 7 steps**

```
1. browse → Search
2. search_results → ViewSite
3. site_detail → AddToCart (cart=1)
4. date_picker → PickDates
5. auth_gate → ChooseSignIn
6. sign_in → SignIn (skips shipping + payment → lands on review)
7. review → ReviewOrder
8. confirm → ConfirmOrder → done
```

**Longest non-abandoning path (new user, guest): 11 steps**

```
1. browse → Search
2. search_results → ViewSite
3. site_detail → AddToCart
4. date_picker → PickDates
5. auth_gate → ChooseGuest
6. guest_info → EnterGuestInfo
7. shipping → EnterShipping
8. payment → EnterPayment
9. review → ReviewOrder
10. confirm → ConfirmOrder → done
```

**The gap**: Best case is 7 steps. Worst case (most common for new users) is 11 steps. That's a 57% overhead for new users — the people least committed to completing the flow.

---

## Reductive Analysis: Simplification Suggestions

After running TLC, analyze the state graph for reduction opportunities. Each suggestion includes the **evidence** from the spec and a note that there may be intentional reasons to keep the current design.

### Suggestion 1: Merge `search_results` and `site_detail`

**Evidence**: Every path goes `search_results → ViewSite → site_detail`. No path skips `search_results` or returns to it after viewing a site (in this model). The two screens form a mandatory pair.

**Possible simplification**: Show site details inline in search results (expandable card, slide-over panel, or modal). User goes from browse → search-with-inline-detail in one step.

**Saves**: 1 step for all users.

**Why you might keep it**: SEO (dedicated URLs per site), deep-linking from external sources, mobile viewport constraints.

### Suggestion 2: Merge `site_detail` and `date_picker`

**Evidence**: `AddToCart` always transitions to `date_picker`. The date picker can't be reached without selecting a site. These are tightly coupled — you're always picking dates *for* a specific site.

**Possible simplification**: Show date availability directly on the site detail page. "Select dates" is a section, not a separate screen.

**Saves**: 1 step for all users.

**Why you might keep it**: Complex date picker UI needs full screen on mobile, A/B testing showed higher engagement with dedicated picker, calendar component is reused elsewhere.

### Suggestion 3: Eliminate `auth_gate` as a separate screen

**Evidence**: `auth_gate` is a routing node — it doesn't collect information, it just branches. Every path passes through it but the user only makes one choice (guest/sign-in/register). The decision could be made implicitly.

**Possible simplification**: After date selection, go straight to a combined form. Show "Sign in for faster checkout" as an inline option, not a gate. Default to guest flow — don't force a choice.

**Saves**: 1 step for all users.

**Why you might keep it**: Conversion data shows logged-in users complete 3x more often, business wants to encourage account creation, A/B test pending.

### Suggestion 4: Merge `guest_info` and `shipping`

**Evidence**: For guest users, the path is always `guest_info → shipping`. Both screens collect contact/address information. Guest info (name, email) and shipping (address) are conceptually one form.

**Possible simplification**: Single "Your details" form with name, email, and address fields.

**Saves**: 1 step for guest users.

**Why you might keep it**: Progressive disclosure (fewer fields per screen reduces perceived effort), email-first allows abandoned cart recovery before collecting full address.

### Suggestion 5: Merge `review` and `confirm`

**Evidence**: `ReviewOrder` always transitions to `confirm`. The review screen is read-only — it doesn't collect new information. The confirm screen just has a button.

**Possible simplification**: Put the "Place Order" button on the review screen. One screen, not two.

**Saves**: 1 step for all users.

**Why you might keep it**: Legal/compliance requires explicit confirmation step, high-value orders benefit from friction, reduces accidental orders.

### Suggestion 6: Skip `shipping` + `payment` for returning users (already implemented)

**Evidence**: The `SignIn` action already routes returning users with saved data directly to `review`. This is the spec confirming the design is correct — this shortcut is load-bearing for the 7-step best case.

**No change needed** — but verify the implementation actually does this. The spec says it should.

### Summary: potential reduction

| User type | Current steps | After all suggestions | Reduction |
|-----------|--------------|----------------------|-----------|
| Returning (saved everything) | 7 | 4 | -43% |
| Returning (no saved data) | 9 | 6 | -33% |
| New user (register) | 10 | 6 | -40% |
| Guest | 11 | 7 | -36% |

The **maximum theoretical minimum** (from spec analysis) is 4 steps: browse → select+dates → pay → done. Whether you can actually get there depends on the reasons in the "why you might keep it" sections.

---

## How to Apply This Pattern to Any Flow

### Step 1: Model the flow as-is

Write one TLA+ action per screen transition. Be honest about the current design — don't model what you wish it was.

### Step 2: Run TLC with the `NotDone` trick

Add an invariant that says the goal state is never reached. TLC's counterexample is the shortest path.

### Step 3: Count paths by user type

Use nondeterministic `Init` to model user segments (new/returning, guest/authenticated, mobile/desktop). Compare shortest paths across segments.

### Step 4: Identify mandatory pairs

Look for screens where A always leads to B and B is only reachable from A. These are merge candidates.

### Step 5: Identify routing-only nodes

Screens that don't collect information or modify state — they only branch. These can often be eliminated by making the routing implicit.

### Step 6: Identify skippable screens

Screens that some paths skip entirely (via guards like `hasSavedPayment`). Ask: can more users skip this screen? What data would enable that?

### Step 7: Present as suggestions, not mandates

The spec tells you what's **structurally** redundant. It can't tell you about:
- Legal/compliance requirements for explicit steps
- A/B test data showing friction improves conversion
- Business goals (account creation, upsell opportunities)
- Accessibility needs (fewer fields per screen)
- Mobile constraints (screen real estate)

Frame every suggestion as: "The spec shows this is removable. Here's why you might still keep it."

---

## Mapping to Code

| TLA+ | Implementation |
|------|---------------|
| `screen` variable | React Router path or stepper `currentStep` index |
| Each action | Route transition handler / `navigate()` call |
| `Init` with nondeterminism | User context from auth state / localStorage |
| `NotDone` invariant trick | Analytics: measure actual step count per completed flow |
| Mandatory pairs | Candidates for component composition (two panels, one route) |
| Routing-only nodes | Replace with conditional logic in the preceding screen's `onNext` |
| Step counter | Analytics event: `flow_step_reached` with step number and screen name |

### Validating reductions in production

After implementing a simplification, verify with analytics:

```typescript
// Track actual path length per user
analytics.track('checkout_step', {
  step: currentStep,
  screen: screenName,
  userType: user.isGuest ? 'guest' : 'returning',
  hasSavedPayment: !!user.savedPayment,
  totalSteps: stepsSoFar,
});

// Compare: did the merge actually reduce steps?
// Expected from spec: guest flow drops from 11 to 7 steps
```

The spec gives you the theoretical minimum. Analytics tells you if users are actually hitting it or getting stuck in loops the spec didn't model (back-button, re-editing, error recovery).
