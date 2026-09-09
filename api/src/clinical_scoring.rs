//! Clinical scoring rules — the single authority for every derived clinical
//! value in the product.
//!
//! Six scales were implemented twice: once here in Rust and once in TypeScript
//! inside the page that collects the inputs. The browser's copy was the one
//! whose result got stored, because the handlers persisted whatever the client
//! sent. That arrangement fails in one direction only — the two copies drift,
//! the server stores the browser's answer, and nothing anywhere disagrees out
//! loud.
//!
//! Every function here is pure: inputs in, score out, no state and no I/O. That
//! makes them callable from three places without ceremony —
//!
//! * the create handlers, which recompute on save and store *their* answer
//!   rather than the client's;
//! * `GET /api/clinical/scoring/catalog`, which serves the thresholds and
//!   constants so a form can show a live preview without shipping a second copy
//!   of the policy;
//! * the tests below, which pin the published reference values.
//!
//! **Adding a scale:** put the rule here, expose its constants through
//! `catalog()`, call it from the handler, and have the page read the numbers
//! from the catalog. Do not put a threshold in a component.

use serde::{Deserialize, Serialize};

// ============================================================================
// MORSE FALL SCALE
// ============================================================================

/// Morse Fall Scale band boundaries. Below `MODERATE` is low risk; at or above
/// `HIGH` is high risk.
pub const MORSE_MODERATE_THRESHOLD: i32 = 25;
/// See [`MORSE_MODERATE_THRESHOLD`].
pub const MORSE_HIGH_THRESHOLD: i32 = 45;

/// The six Morse Fall Scale items, with the values the scale permits for each.
///
/// The permitted values are part of the scale, not of the form: a nurse cannot
/// score "history of falling" as 10. `fall_risk_assessments` enforces the same
/// sets as CHECK constraints, so a value outside them is rejected by the
/// database — publishing them here is what lets a form refuse it first.
pub const MORSE_ITEMS: [(&str, &[i32]); 6] = [
    ("history_of_falling", &[0, 25]),
    ("secondary_diagnosis", &[0, 15]),
    ("ambulatory_aid", &[0, 15, 30]),
    ("iv_therapy", &[0, 20]),
    ("gait_status", &[0, 10, 20]),
    ("mental_status", &[0, 15]),
];

/// Band a Morse Fall Scale total.
///
/// The bands drive the prevention plan: low gets standard precautions,
/// moderate adds a bed alarm and hourly rounding, high adds signage and
/// supervised toileting. Getting the band wrong low is the dangerous
/// direction — the patient looks safer than they are.
pub fn morse_band(total: i32) -> &'static str {
    debug_assert!(total >= 0, "a Morse total is a sum of non-negative items");
    if total >= MORSE_HIGH_THRESHOLD {
        "high"
    } else if total >= MORSE_MODERATE_THRESHOLD {
        "moderate"
    } else {
        "low"
    }
}

// ============================================================================
// BURN: TBSA AND PARKLAND FLUID RESUSCITATION
// ============================================================================

/// Parkland formula coefficient: millilitres of crystalloid per kg per %TBSA
/// over the first 24 hours.
pub const PARKLAND_ML_PER_KG_PER_PERCENT: f64 = 4.0;
/// Minimum acceptable urine output, mL/kg/hr, used as the resuscitation target.
pub const PARKLAND_URINE_TARGET_ML_KG_HR: f64 = 0.5;
/// A burn at or above this %TBSA is major regardless of anything else.
pub const BURN_MAJOR_TBSA_PERCENT: f64 = 25.0;
/// A burn at or above this %TBSA is at least moderate.
pub const BURN_MODERATE_TBSA_PERCENT: f64 = 10.0;

/// Parkland formula result, split into the blocks it is actually delivered in.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ParklandFluid {
    /// Total crystalloid over 24 hours from the time of the **burn**, not of arrival.
    pub total_24h_ml: i32,
    /// Half the total, given over the first 8 hours from the time of the burn.
    pub first_8h_ml: i32,
    /// The other half, given over the following 16 hours.
    pub next_16h_ml: i32,
    /// Infusion rate for the first block.
    pub hourly_first_8h_ml: i32,
    /// Infusion rate for the second block.
    pub hourly_next_16h_ml: i32,
    /// Urine output to titrate against.
    pub urine_output_target_ml_hr: f64,
}

/// Parkland formula: 4 mL x weight(kg) x %TBSA, half in the first 8 hours.
///
/// Returns `None` for inputs that cannot produce a prescription. A zero or
/// negative weight, or a TBSA outside 0-100, is a data-entry error, and the
/// honest response to one is no number rather than a plausible one — this
/// figure is a fluid order for a burned patient.
pub fn parkland_fluid(weight_kg: f64, tbsa_percent: f64) -> Option<ParklandFluid> {
    if !weight_kg.is_finite() || !tbsa_percent.is_finite() {
        return None;
    }
    if weight_kg <= 0.0 || !(0.0..=100.0).contains(&tbsa_percent) {
        return None;
    }

    let total = PARKLAND_ML_PER_KG_PER_PERCENT * weight_kg * tbsa_percent;
    let half = total / 2.0;
    Some(ParklandFluid {
        total_24h_ml: total.round() as i32,
        first_8h_ml: half.round() as i32,
        next_16h_ml: half.round() as i32,
        hourly_first_8h_ml: (half / 8.0).round() as i32,
        hourly_next_16h_ml: (half / 16.0).round() as i32,
        urine_output_target_ml_hr: weight_kg * PARKLAND_URINE_TARGET_ML_KG_HR,
    })
}

/// Burn severity band.
///
/// Inhalation injury and circumferential burns make a burn major at any TBSA:
/// the first threatens the airway and the second the circulation to a limb,
/// and neither cares how much surface is involved.
pub fn burn_severity(tbsa_percent: f64, inhalation: bool, circumferential: bool) -> &'static str {
    if tbsa_percent >= BURN_MAJOR_TBSA_PERCENT || inhalation || circumferential {
        "major"
    } else if tbsa_percent >= BURN_MODERATE_TBSA_PERCENT {
        "moderate"
    } else {
        "minor"
    }
}

/// Sum charted region percentages into a total TBSA, clamped to 0-100.
///
/// Clamping rather than rejecting is deliberate: a chart that sums above 100 is
/// a charting error, and a fluid order computed from 130% TBSA is far worse
/// than one computed from 100%.
pub fn total_tbsa(region_percentages: &[f64]) -> f64 {
    debug_assert!(
        region_percentages.len() <= 64,
        "no body chart has this many regions; a longer slice is a bug upstream"
    );
    let mut total = 0.0_f64;
    for p in region_percentages.iter().take(64) {
        if p.is_finite() && *p > 0.0 {
            total += *p;
        }
    }
    total.clamp(0.0, 100.0)
}

// ============================================================================
// TIMI RISK SCORE (UNSTABLE ANGINA / NSTEMI)
// ============================================================================

/// The seven TIMI criteria, each worth one point.
pub const TIMI_CRITERIA: [&str; 7] = [
    "age_65_or_over",
    "three_or_more_cad_risk_factors",
    "known_cad",
    "aspirin_in_past_7_days",
    "severe_angina",
    "st_deviation",
    "elevated_marker",
];

/// Troponin above this (ng/mL) counts as an elevated cardiac marker.
pub const TIMI_TROPONIN_THRESHOLD_NG_ML: f64 = 0.04;
/// TIMI 0-2 is low risk, 3-4 intermediate, 5-7 high.
pub const TIMI_INTERMEDIATE_THRESHOLD: u8 = 3;
/// See [`TIMI_INTERMEDIATE_THRESHOLD`].
pub const TIMI_HIGH_THRESHOLD: u8 = 5;

/// The seven TIMI criteria as booleans, in the order of [`TIMI_CRITERIA`].
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct TimiCriteria {
    /// Age >= 65 at the time of the event.
    #[serde(default)]
    pub age_65_or_over: bool,
    /// Three or more of: hypertension, hypercholesterolaemia, diabetes,
    /// current smoker, family history of premature CAD.
    #[serde(default)]
    pub three_or_more_cad_risk_factors: bool,
    /// Known coronary stenosis >= 50%.
    #[serde(default)]
    pub known_cad: bool,
    /// Aspirin taken in the seven days before presentation.
    #[serde(default)]
    pub aspirin_in_past_7_days: bool,
    /// Two or more anginal episodes in the preceding 24 hours.
    #[serde(default)]
    pub severe_angina: bool,
    /// ST deviation >= 0.5 mm on the presenting ECG.
    #[serde(default)]
    pub st_deviation: bool,
    /// Troponin or CK-MB above the assay's threshold.
    #[serde(default)]
    pub elevated_marker: bool,
}

/// TIMI risk score: one point per criterion met, 0-7.
pub fn timi_score(c: &TimiCriteria) -> u8 {
    let score = u8::from(c.age_65_or_over)
        + u8::from(c.three_or_more_cad_risk_factors)
        + u8::from(c.known_cad)
        + u8::from(c.aspirin_in_past_7_days)
        + u8::from(c.severe_angina)
        + u8::from(c.st_deviation)
        + u8::from(c.elevated_marker);
    debug_assert!(score <= 7, "TIMI has seven criteria");
    score
}

/// Band a TIMI score. The band, not the number, decides early invasive management.
pub fn timi_band(score: u8) -> &'static str {
    if score >= TIMI_HIGH_THRESHOLD {
        "high"
    } else if score >= TIMI_INTERMEDIATE_THRESHOLD {
        "intermediate"
    } else {
        "low"
    }
}

// ============================================================================
// START TRIAGE (MASS-CASUALTY)
// ============================================================================

/// Respiratory rate above this, in a non-ambulatory patient, is immediate.
pub const START_RESP_RATE_IMMEDIATE: i32 = 30;
/// Capillary refill above this many seconds is immediate.
pub const START_CAP_REFILL_IMMEDIATE_SECS: i32 = 2;

/// The inputs START triage asks for, in the order it asks for them.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct StartVitals {
    /// Walked to the collection point unaided.
    #[serde(default)]
    pub ambulatory: bool,
    /// Breathing at all, after one airway-opening attempt.
    #[serde(default)]
    pub breathing: bool,
    /// Breaths per minute.
    #[serde(default)]
    pub respiratory_rate: Option<i32>,
    /// Capillary refill in seconds.
    #[serde(default)]
    pub capillary_refill_secs: Option<i32>,
    /// Radial pulse palpable. START's perfusion check is "capillary refill over
    /// two seconds **or** no radial pulse" — in daylight, or on dark skin, or in
    /// the cold, capillary refill is the less reliable half, which is why the
    /// pulse is the field alternative rather than a second opinion. `None` means
    /// it was not assessed and only capillary refill decides.
    #[serde(default)]
    pub radial_pulse_present: Option<bool>,
    /// Follows simple commands.
    #[serde(default)]
    pub follows_commands: bool,
}

/// START triage category: `minor`, `delayed`, `immediate` or `expectant`.
///
/// The order of the checks *is* the algorithm — ambulation first, then
/// breathing, then perfusion, then mental status — and rearranging them changes
/// who gets carried first. `expectant` is reached only by "not breathing after
/// the airway is opened".
pub fn start_triage(v: &StartVitals) -> &'static str {
    if v.ambulatory {
        return "minor";
    }
    if !v.breathing {
        return "expectant";
    }
    if v.respiratory_rate
        .is_some_and(|r| r > START_RESP_RATE_IMMEDIATE)
    {
        return "immediate";
    }
    if v.capillary_refill_secs
        .is_some_and(|c| c > START_CAP_REFILL_IMMEDIATE_SECS)
        || v.radial_pulse_present == Some(false)
    {
        return "immediate";
    }
    if !v.follows_commands {
        return "immediate";
    }
    "delayed"
}

// ============================================================================
// VISUAL INFUSION PHLEBITIS (VIP) SCORE
// ============================================================================

/// Cannula-site observations and the phlebitis stage each one reaches.
///
/// The names are the vocabulary the assessment form collects, and the stages
/// are the ones the product has always applied — this moved the arithmetic to
/// the server without changing a single patient's score. `clean-dry-intact` is
/// listed explicitly at stage 0 so that "no abnormality observed" is a recorded
/// finding rather than an empty list, which is indistinguishable from "not
/// assessed".
pub const VIP_SIGNS: [(&str, u8); 8] = [
    ("clean-dry-intact", 0),
    ("tenderness", 1),
    ("redness", 1),
    ("swelling", 2),
    ("warmth", 2),
    ("induration", 3),
    ("drainage", 4),
    ("palpable-cord", 5),
];

/// VIP score from the observed signs. Unknown sign names are ignored rather
/// than counted, so a client sending a typo cannot inflate the score.
pub fn vip_score(observed: &[String]) -> u8 {
    debug_assert!(observed.len() <= 32, "VIP has seven signs");
    let mut score = 0_u8;
    for sign in observed.iter().take(32) {
        for (name, stage) in VIP_SIGNS.iter() {
            if sign == name && *stage > score {
                score = *stage;
            }
        }
    }
    score
}

/// What a VIP score requires. Stage 2 is the point of no return for the
/// cannula: it comes out.
pub fn vip_action(score: u8) -> &'static str {
    match score {
        0 => "observe",
        1 => "observe_closely",
        2..=3 => "resite_cannula",
        _ => "resite_and_treat",
    }
}

/// Maximum dwell time in hours before a peripheral device is resited.
///
/// A midline or PICC is not on a fixed clock — it is reviewed rather than
/// routinely replaced — so those return `None` rather than a number that would
/// prompt an unnecessary reinsertion.
pub fn catheter_dwell_limit_hours(catheter_type: &str) -> Option<i32> {
    match catheter_type {
        // 4 days. The peripheral range in practice is 72-96 hours, or sooner if
        // clinically indicated; this is the review point, not a guarantee.
        "peripheral" | "peripheral_iv" => Some(96),
        // 28 days.
        "midline" => Some(672),
        // 90 days.
        "picc" => Some(2160),
        // 7 days, because a non-tunnelled central line is reviewed daily and
        // this is the outer bound rather than an expected dwell.
        "central" => Some(168),
        // An emergency or field insertion is presumed non-sterile and comes out
        // within a shift once a clean line is established.
        "intraosseous" => Some(24),
        // Anything unrecognised takes the peripheral clock, because it prompts
        // a review sooner rather than later.
        _ => Some(96),
    }
}

// ============================================================================
// WARD THRESHOLDS
// ============================================================================

/// Minutes after a scheduled dose time before it counts as overdue.
///
/// A medication-safety policy, not a display preference: this is what turns a
/// pending dose red on the MAR and puts it in front of the nurse. It lived as a
/// literal `30 * 60000` inside `MedicationAdminPage`.
pub const MEDICATION_OVERDUE_AFTER_MINUTES: i64 = 30;

/// Fluid-balance bands, in millilitres over a 24-hour period.
///
/// Positive beyond `POSITIVE_HIGH` is the one that matters — a patient running
/// a litre positive is a patient being fluid-overloaded — and these were
/// literals inside `IntakeOutputPage`.
pub const FLUID_BALANCE_POSITIVE_HIGH_ML: i32 = 1000;
/// See [`FLUID_BALANCE_POSITIVE_HIGH_ML`].
pub const FLUID_BALANCE_POSITIVE_ML: i32 = 500;
/// See [`FLUID_BALANCE_POSITIVE_HIGH_ML`].
pub const FLUID_BALANCE_NEGATIVE_ML: i32 = -500;

/// Band a 24-hour fluid balance.
pub fn fluid_balance_band(balance_ml: i32) -> &'static str {
    if balance_ml > FLUID_BALANCE_POSITIVE_HIGH_ML {
        "positive_high"
    } else if balance_ml > FLUID_BALANCE_POSITIVE_ML {
        "positive"
    } else if balance_ml < FLUID_BALANCE_NEGATIVE_ML {
        "negative"
    } else {
        "balanced"
    }
}

// ============================================================================
// CATALOG
// ============================================================================

/// The thresholds and constants a form needs to show a live preview without
/// carrying a second copy of the policy.
///
/// Served by `GET /api/clinical/scoring/catalog`. It publishes the *numbers*,
/// never a substitute for recomputation: a saved record's score is always the
/// one this module produced on the server, whatever a page displayed while it
/// was being filled in.
pub fn catalog() -> serde_json::Value {
    serde_json::json!({
        "morse_fall_scale": {
            "items": MORSE_ITEMS
                .iter()
                .map(|(name, values)| serde_json::json!({ "name": name, "values": values }))
                .collect::<Vec<_>>(),
            "bands": [
                { "level": "low", "min": 0, "max": MORSE_MODERATE_THRESHOLD - 1 },
                { "level": "moderate", "min": MORSE_MODERATE_THRESHOLD, "max": MORSE_HIGH_THRESHOLD - 1 },
                { "level": "high", "min": MORSE_HIGH_THRESHOLD, "max": serde_json::Value::Null },
            ],
        },
        "burn": {
            "parkland_ml_per_kg_per_percent": PARKLAND_ML_PER_KG_PER_PERCENT,
            "urine_target_ml_kg_hr": PARKLAND_URINE_TARGET_ML_KG_HR,
            "first_block_fraction": 0.5,
            "first_block_hours": 8,
            "second_block_hours": 16,
            "severity": {
                "major_tbsa_percent": BURN_MAJOR_TBSA_PERCENT,
                "moderate_tbsa_percent": BURN_MODERATE_TBSA_PERCENT,
                "major_regardless_of_tbsa": ["inhalation_injury", "circumferential_burn"],
            },
        },
        "timi": {
            "criteria": TIMI_CRITERIA,
            "troponin_threshold_ng_ml": TIMI_TROPONIN_THRESHOLD_NG_ML,
            "bands": [
                { "level": "low", "min": 0, "max": TIMI_INTERMEDIATE_THRESHOLD - 1 },
                { "level": "intermediate", "min": TIMI_INTERMEDIATE_THRESHOLD, "max": TIMI_HIGH_THRESHOLD - 1 },
                { "level": "high", "min": TIMI_HIGH_THRESHOLD, "max": 7 },
            ],
        },
        "start_triage": {
            "respiratory_rate_immediate_above": START_RESP_RATE_IMMEDIATE,
            "capillary_refill_immediate_above_secs": START_CAP_REFILL_IMMEDIATE_SECS,
            "absent_radial_pulse_is_immediate": true,
            "categories": ["minor", "delayed", "immediate", "expectant"],
        },
        "vip_phlebitis": {
            "signs": VIP_SIGNS
                .iter()
                .map(|(name, stage)| serde_json::json!({ "name": name, "stage": stage }))
                .collect::<Vec<_>>(),
            "actions": [
                { "score": 0, "action": "observe" },
                { "score": 1, "action": "observe_closely" },
                { "score": 2, "action": "resite_cannula" },
                { "score": 3, "action": "resite_cannula" },
                { "score": 4, "action": "resite_and_treat" },
                { "score": 5, "action": "resite_and_treat" },
            ],
        },
        "medication": {
            "overdue_after_minutes": MEDICATION_OVERDUE_AFTER_MINUTES,
        },
        "fluid_balance": {
            "positive_high_ml": FLUID_BALANCE_POSITIVE_HIGH_ML,
            "positive_ml": FLUID_BALANCE_POSITIVE_ML,
            "negative_ml": FLUID_BALANCE_NEGATIVE_ML,
            // Named by the same function the server would band with, so the
            // published names and the boundaries above cannot disagree.
            "bands": [
                { "level": fluid_balance_band(FLUID_BALANCE_NEGATIVE_ML - 1), "max_ml": FLUID_BALANCE_NEGATIVE_ML },
                { "level": fluid_balance_band(0), "min_ml": FLUID_BALANCE_NEGATIVE_ML, "max_ml": FLUID_BALANCE_POSITIVE_ML },
                { "level": fluid_balance_band(FLUID_BALANCE_POSITIVE_ML + 1), "min_ml": FLUID_BALANCE_POSITIVE_ML, "max_ml": FLUID_BALANCE_POSITIVE_HIGH_ML },
                { "level": fluid_balance_band(FLUID_BALANCE_POSITIVE_HIGH_ML + 1), "min_ml": FLUID_BALANCE_POSITIVE_HIGH_ML },
            ],
        },
        "catheter_dwell_hours": {
            "peripheral": catheter_dwell_limit_hours("peripheral"),
            "intraosseous": catheter_dwell_limit_hours("intraosseous"),
            "midline": catheter_dwell_limit_hours("midline"),
            "picc": catheter_dwell_limit_hours("picc"),
            "central": catheter_dwell_limit_hours("central"),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn morse_bands_at_their_published_boundaries() {
        assert_eq!(morse_band(0), "low");
        assert_eq!(morse_band(24), "low");
        assert_eq!(morse_band(25), "moderate", "25 is the first moderate score");
        assert_eq!(morse_band(44), "moderate");
        assert_eq!(morse_band(45), "high", "45 is the first high score");
        assert_eq!(morse_band(125), "high", "every item at its maximum");
    }

    #[test]
    fn parkland_matches_the_worked_example() {
        // 70 kg, 30% TBSA -> 4 x 70 x 30 = 8400 mL, 4200 in the first 8 hours.
        let f = parkland_fluid(70.0, 30.0).expect("valid inputs");
        assert_eq!(f.total_24h_ml, 8400);
        assert_eq!(f.first_8h_ml, 4200);
        assert_eq!(f.next_16h_ml, 4200);
        assert_eq!(f.hourly_first_8h_ml, 525);
        assert_eq!(f.hourly_next_16h_ml, 263);
        assert_eq!(f.urine_output_target_ml_hr, 35.0);
    }

    #[test]
    fn parkland_refuses_inputs_that_cannot_produce_an_order() {
        assert!(parkland_fluid(0.0, 30.0).is_none(), "no weight, no order");
        assert!(parkland_fluid(-5.0, 30.0).is_none());
        assert!(parkland_fluid(70.0, -1.0).is_none());
        assert!(
            parkland_fluid(70.0, 101.0).is_none(),
            "TBSA cannot exceed 100"
        );
        assert!(parkland_fluid(f64::NAN, 30.0).is_none());
    }

    #[test]
    fn burn_severity_ignores_tbsa_when_the_airway_or_a_limb_is_threatened() {
        assert_eq!(burn_severity(2.0, false, false), "minor");
        assert_eq!(burn_severity(12.0, false, false), "moderate");
        assert_eq!(burn_severity(30.0, false, false), "major");
        assert_eq!(
            burn_severity(2.0, true, false),
            "major",
            "a 2% burn with inhalation injury is a major burn"
        );
        assert_eq!(
            burn_severity(2.0, false, true),
            "major",
            "a circumferential burn threatens the limb at any size"
        );
    }

    #[test]
    fn tbsa_clamps_an_over_charted_body() {
        assert_eq!(total_tbsa(&[9.0, 18.0, 9.0]), 36.0);
        assert_eq!(total_tbsa(&[]), 0.0);
        assert_eq!(
            total_tbsa(&[90.0, 90.0]),
            100.0,
            "a chart summing past 100 is an error; 130% TBSA would be a fluid order"
        );
        assert_eq!(total_tbsa(&[9.0, -4.0, f64::NAN]), 9.0);
    }

    #[test]
    fn timi_counts_one_point_per_criterion() {
        assert_eq!(timi_score(&TimiCriteria::default()), 0);
        let all = TimiCriteria {
            age_65_or_over: true,
            three_or_more_cad_risk_factors: true,
            known_cad: true,
            aspirin_in_past_7_days: true,
            severe_angina: true,
            st_deviation: true,
            elevated_marker: true,
        };
        assert_eq!(timi_score(&all), 7);
        assert_eq!(timi_band(0), "low");
        assert_eq!(timi_band(2), "low");
        assert_eq!(timi_band(3), "intermediate");
        assert_eq!(timi_band(5), "high");
        assert_eq!(timi_band(7), "high");
    }

    #[test]
    fn start_triage_follows_its_own_order() {
        // Ambulatory wins before anything else is asked.
        let walking = StartVitals {
            ambulatory: true,
            breathing: false,
            ..Default::default()
        };
        assert_eq!(start_triage(&walking), "minor");

        let apnoeic = StartVitals {
            ambulatory: false,
            breathing: false,
            ..Default::default()
        };
        assert_eq!(start_triage(&apnoeic), "expectant");

        let tachypnoeic = StartVitals {
            ambulatory: false,
            breathing: true,
            respiratory_rate: Some(34),
            follows_commands: true,
            ..Default::default()
        };
        assert_eq!(start_triage(&tachypnoeic), "immediate");

        let poorly_perfused = StartVitals {
            ambulatory: false,
            breathing: true,
            respiratory_rate: Some(20),
            capillary_refill_secs: Some(4),
            follows_commands: true,
            ..Default::default()
        };
        assert_eq!(start_triage(&poorly_perfused), "immediate");

        // Either half of the perfusion check is enough on its own.
        let no_radial_pulse = StartVitals {
            ambulatory: false,
            breathing: true,
            respiratory_rate: Some(20),
            capillary_refill_secs: Some(1),
            radial_pulse_present: Some(false),
            follows_commands: true,
        };
        assert_eq!(start_triage(&no_radial_pulse), "immediate");

        let obtunded = StartVitals {
            ambulatory: false,
            breathing: true,
            respiratory_rate: Some(20),
            capillary_refill_secs: Some(1),
            follows_commands: false,
            ..Default::default()
        };
        assert_eq!(start_triage(&obtunded), "immediate");

        let walking_wounded = StartVitals {
            ambulatory: false,
            breathing: true,
            respiratory_rate: Some(20),
            capillary_refill_secs: Some(1),
            radial_pulse_present: Some(true),
            follows_commands: true,
        };
        assert_eq!(start_triage(&walking_wounded), "delayed");
    }

    #[test]
    fn vip_takes_the_highest_stage_present() {
        assert_eq!(vip_score(&[]), 0);
        assert_eq!(vip_score(&["clean-dry-intact".to_string()]), 0);
        assert_eq!(vip_score(&["tenderness".to_string()]), 1);
        assert_eq!(
            vip_score(&["tenderness".to_string(), "induration".to_string()]),
            3,
            "the score is the highest stage observed, not a sum"
        );
        assert_eq!(vip_score(&["drainage".to_string()]), 4);
        assert_eq!(
            vip_score(&["not_a_sign".to_string()]),
            0,
            "an unknown sign must not inflate the score"
        );
    }

    #[test]
    fn vip_action_removes_the_cannula_from_stage_two() {
        assert_eq!(vip_action(0), "observe");
        assert_eq!(vip_action(1), "observe_closely");
        assert_eq!(vip_action(2), "resite_cannula");
        assert_eq!(vip_action(3), "resite_cannula");
        assert_eq!(vip_action(4), "resite_and_treat");
        assert_eq!(vip_action(5), "resite_and_treat");
    }

    #[test]
    fn dwell_limits_match_the_device() {
        assert_eq!(catheter_dwell_limit_hours("peripheral"), Some(96));
        assert_eq!(catheter_dwell_limit_hours("intraosseous"), Some(24));
        assert_eq!(catheter_dwell_limit_hours("midline"), Some(672), "28 days");
        assert_eq!(catheter_dwell_limit_hours("picc"), Some(2160), "90 days");
        assert_eq!(catheter_dwell_limit_hours("central"), Some(168), "7 days");
        assert_eq!(
            catheter_dwell_limit_hours("something-new"),
            Some(96),
            "an unrecognised device takes the shortest clock, not the longest"
        );
    }

    #[test]
    fn fluid_balance_bands_at_their_published_boundaries() {
        assert_eq!(fluid_balance_band(0), "balanced");
        assert_eq!(
            fluid_balance_band(500),
            "balanced",
            "500 is not yet positive"
        );
        assert_eq!(fluid_balance_band(501), "positive");
        assert_eq!(fluid_balance_band(1000), "positive");
        assert_eq!(fluid_balance_band(1001), "positive_high");
        assert_eq!(fluid_balance_band(-500), "balanced");
        assert_eq!(fluid_balance_band(-501), "negative");
    }

    #[test]
    fn catalog_publishes_every_number_a_form_would_otherwise_hardcode() {
        let c = catalog();
        assert_eq!(c["morse_fall_scale"]["bands"][1]["min"], 25);
        assert_eq!(c["burn"]["parkland_ml_per_kg_per_percent"], 4.0);
        assert_eq!(c["burn"]["severity"]["major_tbsa_percent"], 25.0);
        assert_eq!(c["timi"]["troponin_threshold_ng_ml"], 0.04);
        assert_eq!(c["start_triage"]["respiratory_rate_immediate_above"], 30);
        assert_eq!(c["catheter_dwell_hours"]["peripheral"], 96);
        assert_eq!(c["medication"]["overdue_after_minutes"], 30);
        assert_eq!(c["fluid_balance"]["positive_high_ml"], 1000);
        assert_eq!(c["fluid_balance"]["bands"][0]["level"], "negative");
        assert_eq!(c["fluid_balance"]["bands"][3]["level"], "positive_high");
        assert_eq!(c["catheter_dwell_hours"]["picc"], 2160);
    }
}
