# Cache — Design Principles for Cognitive Accessibility

**Audience:** internal team · **Basis:** evidence-led, mapped to Cache

## The core insight — one design need across three conditions, one product shape

ADHD, autism, and TBI have different origins but converge on the same design requirement: **executive-function support** — task initiation, working memory, planning, self-regulation [1][2]. That's the case for a tool that deliberately spans them. The W3C's *Making Content Usable* (COGA) codifies the same conclusion as eight design objectives — most importantly, "processes must not rely on memory" and "support adaptation and personalization" [3]. Curb-cut effect: designing well for cognitive disability makes the product better for everyone [4].

Reach is large. ADHD affects ~6.0% of US adults (~15.5M) [5]; autism ~2.21% of US adults (~5.4M), and most autistic adults are undiagnosed so real usership exceeds diagnosis rates [6][7]; TBI produced ~214k US hospitalizations in 2020 with millions living with related disability [8].

**The gap the field leaves open.** Competitors (Tiimo, Goblin Tools, Structured, Inflow, Numo, Sunsama, Motion) are almost entirely single-purpose and ADHD-branded. The real pain our users report isn't "no tool exists" — it's that **existing tools demand heavy manual entry, don't talk to each other, and force people to hold state across apps.** Every field to fill, every silo to reconcile, every context-switch is an EF tax. A life OS built as one main, interconnected data layer with auto-import **is** the cognitive-accessibility answer, not a feature added on top of it. Money is the first area because it's the highest-stakes, best-data-available domain — the same shell will absorb work, time, health, and whatever else comes next.

## 1. Reduce the cost of starting

Task initiation is the choke point. The best-evidenced mechanism is **implementation intentions** — pre-linking a task to a trigger ("when X → then Y"). Gollwitzer & Sheeran's 94-study meta-analysis: d = 0.65 overall, d = 0.61 specifically for the "getting started" problem [9]. In ADHD, **event/context cues beat time cues** — "after I sync" beats "at 9am Monday" because time-based intentions overload working memory and vanish [10]. Break tasks into micro-steps and show only the next action; ADHD EF deficits are broad, so reduce activation energy at the point of starting [11].

**For Cache:** the "single most important next thing" indicator is the right shape — one clear action, anchored to an event, phrased as if/when-then. As new life domains land in Cache, each one should answer *"what's the one thing I could do here right now?"* in a single sentence. Guided setups (bank connect today; work/health/whatever tomorrow) should stay one-step-at-a-time flows, not forms.

## 2. Externalize memory and time — and pull data in, don't ask for it

The strongest evidence in cognitive rehab is for external reminder systems. NeuroPage RCT (n=143): 80%+ of completers carried out everyday tasks more successfully with reminders, gains largely held after the device was removed [12]. Electronic assistive tech supports memory after TBI, strongest at the retrieval/execution moment [13]. INCOG 2.0 rates external memory aids **Level A / first-line** [14]. Prospective-memory rehab pools to a moderate, significant effect across 1,405 participants [15]. And "time blindness" is measurable in adult ADHD — visible/countdown timers work because they externalize time rather than assuming an internal clock [16].

**The manual-entry problem is a memory problem.** Asking a fatigued brain to type in what a bank/calendar/tracker already knows is the failure mode our users describe. Every field the app fills for the user is EF tax it doesn't have to pay.

**For Cache:** the permanent ledger, Recurring radar, Months browser, Safe-to-spend forecast, and Streaks/custom trackers already externalize memory and time in the finance area. The design rule for every future area: **auto-import by default** (SimpleFIN, Toggl, calendar, health APIs, CSV drag), **infer aggressively** (auto-categorize, clean merchant names, detect recurring), and **learn once** ("teach it once and it sticks"). The user's role is to confirm and correct, never to key in what a data source already has. Alerts should fire on real events ("your paycheck landed → tag it"), not on the clock.

## 3. Interconnection is the point — one main layer, not many

COGA #6 is blunt: processes must not rely on memory [3]. Siloed apps force the user to be the integration layer — remember what happened in App A when acting in App B. That is exactly the load our users cannot carry.

Cache's architectural rule already reflects this on the finance side: **one main data layer that every widget reads from** (`build_snapshot` → `balances.json` → every widget). Extend that pattern to every area. Work hours from Toggl aren't a separate universe from money — they show up next to the income they earned. A future health/time/task area should read from and write to the same snapshot idea, with the same atomic-writes + permanent-ledger guarantees. **The connective tissue is the product.** A widget that can't show its data alongside another widget's data has failed the test.

**For Cache:** treat every new area as "what does this add to the snapshot everything else reads from?" not "what's a nice standalone widget?" Monotropism [21] argues for respecting a single deep channel of attention — an interconnected canvas lets a user stay in that channel across life domains instead of app-switching to reconstruct context.

## 4. Lower the load, calm the interface

Minimize extraneous cognitive load so working memory goes to the task [17]. COGA: don't require holding info across steps; minimize steps to completion [3]. **Cognitive fatigue is elevated and persistent after TBI** — 64.7% of a TBI cohort above the meaningful-severity threshold vs 25.4% of controls — so favor low-effort, low-step interactions [18]. Reduce non-informational sensory noise; make contrast/brightness/theme adjustable, because tolerances conflict across users [19]. Use **plain, literal language**; avoid idioms and ambiguous icons; keep navigation consistent and predictable [19][3]. Autistic EF difficulty is broad — Hedges' g = 0.48 across 235 studies (n=14,081) — so offload planning and working memory [20].

**For Cache:** the Accessibility Hub, Modes (Minimalist, Standard, Legendary), Comfort presets, seizure-safe motion, and plain widget names ("Where it's going" not "Analytics") are already first-class. **Do more:** audit every widget for hover-only reveals (already in CLAUDE.md — hold the line), ambiguous icons, and any flow that makes the user hold a number across screens. The generative-UI direction in BRAND.md is the right next move — when a task exceeds direct-manipulation comfort, the interface composes itself around intent instead of forcing menu hunts. This matters more, not less, as Cache spans more life domains.

## 5. Design with, flex, and don't punish

Customization is a **requirement, not a nicety** — user needs conflict (some want high contrast, some low; some want density, some breathing room) [3][19]. Co-design matters materially: ~29% of assistive devices are abandoned, driven substantially by users not being involved in design and by tools failing to flex as needs change [22][23]. Neurodiversity-affirming design centers autonomy and avoids deficit-framing or punitive mechanics [24].

**For Cache:** "accessibility asks jump the line," opt-in usage sharing, deep drag/resize/theme/font customization, and the cache-as-character system rewarding *real* actions (informational feedback + autonomy support) are the right instincts. Keep this posture as Cache grows.

### What to avoid

- **Over-gamifying.** Expected, tangible, task-contingent rewards undermine intrinsic motivation across a 128-experiment meta-analysis [25]. Cache's EXP/levels/streak system should stay tied to *doing real work* (categorizing, tagging, syncing, whatever the domain), keep feedback informational, and never punish a broken streak with shame or lock-out.
- **Alert fatigue.** Frequent, non-actionable notifications habituate and get dismissed [26]. Cross-area Cache will be tempted to notify from every corner — resist. The "single most important next thing" shape is the ceiling, not the floor.
- **Over-claiming "fewer choices."** The jam study (6 vs 24 options, 10× purchase) [27] pooled to near-zero across 50 experiments (d = 0.02) [28]. Simplify at the *moment of starting* and for novices — that's Minimalist mode's real job. Don't sell it as a universal law.
- **Body doubling is worth exploring.** Working alongside another person improved focus/speed for ADHD users; an AI "double" performed comparably in a small VR study [29]. Plausible non-punitive shape for a Community Cache — accountability without surveillance.

---

## Sources

1. Levi, *The Hairy Bikie and Other Metacognitive Strategies*, Springer 2020. https://link.springer.com/chapter/10.1007/978-3-030-46618-3_4
2. Craig et al., EF deficits in ASD & ADHD, 2016. https://pmc.ncbi.nlm.nih.gov/articles/PMC4869784/
3. W3C, *Making Content Usable for People with Cognitive and Learning Disabilities* (COGA), 2021. https://www.w3.org/TR/coga-usable/
4. Curb-cut effect. https://en.wikipedia.org/wiki/Curb_cut_effect
5. CDC MMWR, ADHD in US adults, 10 Oct 2024. https://www.cdc.gov/mmwr/volumes/73/wr/mm7340a1.htm
6. Dietz et al., US adult autism prevalence, 2020. https://pubmed.ncbi.nlm.nih.gov/32390121/
7. O'Nions et al., undiagnosed autistic adults, *Lancet Reg Health Europe* 2023. https://www.ucl.ac.uk/news/2023/jun/number-autistic-people-england-may-be-twice-high-previously-thought
8. CDC TBI Data. https://www.cdc.gov/traumatic-brain-injury/data-research/index.html
9. Gollwitzer & Sheeran, implementation intentions meta-analysis, 2006 (via NCI). https://cancercontrol.cancer.gov/brp/research/constructs/implementation-intentions
10. CHADD, prospective memory & ADHD, Dec 2025. https://chadd.org/attention-article/remembering-the-future-how-adhd-affects-prospective-memory-and-how-to-work-with-it/
11. Boonstra et al., EF in adult ADHD, *Psychol Med* 2005. https://pubmed.ncbi.nlm.nih.gov/16116936/
12. Wilson et al., NeuroPage RCT, *JNNP* 2001. https://pmc.ncbi.nlm.nih.gov/articles/PMC1737307/
13. Ownsworth et al., electronic assistive tech after TBI, *J Neurotrauma* 2023. https://journals.sagepub.com/doi/full/10.1089/neu.2022.0434
14. Velikonja et al., INCOG 2.0 guidelines, 2023. https://journals.lww.com/headtraumarehab/fulltext/2023/01000/incog_2_0_guidelines_for_cognitive_rehabilitation.7.aspx
15. Papagno et al., prospective-memory rehab meta-analysis, *Scientific Reports* 2026. https://www.nature.com/articles/s41598-025-29423-2
16. Mette, time reproduction in adult ADHD, *IJERPH* 2023. https://pmc.ncbi.nlm.nih.gov/articles/PMC9962130/
17. Nielsen Norman Group, minimize cognitive load. https://www.nngroup.com/articles/minimize-cognitive-load/
18. Wright et al., cognitive fatigue after TBI, *PLOS ONE* 2024. https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0300910
19. Raymaker et al., AASPIRE web accessibility guidelines, *Autism in Adulthood* 2019. https://pmc.ncbi.nlm.nih.gov/articles/PMC6485264/
20. Demetriou et al., autism EF meta-analysis, *Molecular Psychiatry* 2018. https://www.nature.com/articles/mp201775
21. National Autistic Society, monotropism. https://www.autism.org.uk/advice-and-guidance/professional-practice/what-is-monotropism
22. Phillips & Zhao, assistive-tech abandonment, *Assistive Technology* 1993. https://pubmed.ncbi.nlm.nih.gov/10171664/
23. NIHR Evidence, users as design partners. https://evidence.nihr.ac.uk/alert/why-people-abandon-assistive-technologies-research-suggests-users-become-partners-in-design-users/
24. Framework for Neurodiversity-Affirming Interventions, 2023. https://pmc.ncbi.nlm.nih.gov/articles/PMC10430771
25. Deci, Koestner & Ryan, extrinsic rewards meta-analysis, *Psychol Bulletin* 1999. https://pubmed.ncbi.nlm.nih.gov/10589297/
26. Alarm fatigue. https://en.wikipedia.org/wiki/Alarm_fatigue
27. Iyengar & Lepper, choice overload, 2000 (see [28] for pooled effect).
28. Scheibehenne, Greifeneder & Todd, choice-overload meta-analysis, *J Consumer Research* 2010. https://scheibehenne.com/ScheibehenneGreifenederTodd2010.pdf
29. Ara et al., AI body-doubling for ADHD, arXiv 2025. https://arxiv.org/html/2509.12153v1
