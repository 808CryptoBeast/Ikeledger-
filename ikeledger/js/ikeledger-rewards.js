function hashAddressValue(address = "") {
  return [...address].reduce((acc, char, index) => acc + char.charCodeAt(0) * (index + 1), 0);
}

export function getManaSummary(address) {
  if (!address) {
    return {
      mana: 0,
      completedLessons: 0,
      badges: []
    };
  }

  const hash = hashAddressValue(address);
  const completedLessons = (hash % 8) + 2;
  const mana = completedLessons * 10 + (hash % 7);

  const badges = [
    "Lesson Completion Badge",
    "Protocol Awareness Badge",
    completedLessons >= 6 ? "Scholar Path Badge" : "Cultural Bridge Badge"
  ];

  return {
    mana,
    completedLessons,
    badges
  };
}
