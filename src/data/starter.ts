import type { Deck } from "../types";

/** A tiny local deck keeps the first visit useful before a learner imports a file. */
export const STARTER_DECK: Deck = {
  id: "starter-business-basics",
  name: "Business law / warm-up",
  sourceFile: "starter-deck.csv",
  createdAt: "2026-08-21T00:00:00.000Z",
  cards: [
    {
      id: "starter-1",
      question: "What are the five core characteristics of a business corporation?",
      answer: "Legal personality, limited liability, transferability of shares, delegated management, and investor ownership.",
    },
    {
      id: "starter-2",
      question: "Does a sole proprietorship have a separate legal personality?",
      answer: "No. The business and its owner are one legal person, so the owner has unlimited personal liability.",
    },
    {
      id: "starter-3",
      question: "What is the doctrine of separate personality?",
      answer: "A corporation has a personality separate and distinct from its members, shareholders, officers, and other entities.",
    },
    {
      id: "starter-4",
      question: "What is perpetual succession?",
      answer: "The corporation remains the same legal entity despite changes in its members and can continue to manage affairs and hold property.",
    },
    {
      id: "starter-5",
      question: "What is the default corporate term under the RCCP?",
      answer: "Perpetual existence. A corporation may still opt for a fixed term.",
    },
    {
      id: "starter-6",
      question: "What is a joint venture under Philippine law?",
      answer: "A temporary form of partnership, governed by the law of partnerships.",
    },
    {
      id: "starter-7",
      question: "What does limited liability usually mean for a stockholder?",
      answer: "Personal liability for corporate obligations is limited to the extent of the stockholder's unpaid subscription.",
    },
    {
      id: "starter-8",
      question: "What is the highest policy-making body of a cooperative?",
      answer: "The General Assembly.",
    },
  ],
};
