Workflow "HR Summary" with policy, user_id
  Step 1: Search for {policy} using PolicySearch
           Save as doc
  Step 2: Ask Summarizer to "Summarize for staff:\n{doc.text}"
           Save as summary
  Evolve Summarizer using feedback: "Make it shorter and clearer for new hires."
  Constraint: max_generations = 3
  Step 3: Notify {user_id} using Notifier
  Return summary





