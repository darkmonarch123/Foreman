-- Foreman Assistant v1.2: action extraction.
--
-- Four new kinds of finding turn plain sentences into planning items
-- ("Decide:", "Owner:", "Risk:", "Next step:"). Each is still only a proposal
-- to add one new note: nothing is applied without the person accepting it,
-- through the unchanged assistant_accept_proposal. The only schema change is
-- allowing the new rule ids.
alter table public.assistant_proposals drop constraint assistant_proposals_rule_id_check;
alter table public.assistant_proposals add constraint assistant_proposals_rule_id_check
  check (rule_id is null or rule_id in (
    'unanswered_question', 'action_without_owner', 'vague_note', 'possible_duplicate',
    'disconnected_object', 'overlapping_objects', 'theme_without_decision',
    'open_question_without_next_step',
    'extracted_decision', 'extracted_owner', 'extracted_risk', 'extracted_next_step'
  ));
