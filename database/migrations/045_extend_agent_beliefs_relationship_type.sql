ALTER TABLE agent_beliefs
    MODIFY COLUMN belief_type ENUM('identity_fact', 'preference', 'commitment', 'relationship') NOT NULL;
