const artifacts = [
  {
    id: "bastet",
    name: "Bastet, Cat Goddess",
    period: "Late Period · Ancient Egypt",
    date: "c. 664–332 BCE",
    origin: "Egypt",
    civilization: "Ancient Egypt",
    material: "Cat-goddess statue representation",
    intro: "The feline form evokes Bastet, an Egyptian goddess associated with protection, the home, and joyful celebration.",
    significance: "Cat imagery became closely associated with Bastet, whose worship was especially prominent at Bubastis.",
    facts: ["Bastet was worshipped as a protective goddess", "Cats were sacred in several Egyptian contexts"],
    card_uid: import.meta.env.VITE_RFID_UID_BASTET || ""
  },
  {
    id: "nefertiti",
    name: "Bust of Nefertiti",
    period: "18th Dynasty · Amarna Period",
    date: "c. 1345 BCE",
    origin: "Tell el-Amarna, Egypt",
    civilization: "Ancient Egypt",
    material: "Painted limestone and stucco",
    intro: "An enduring image of royal elegance, this painted bust is associated with Nefertiti, the Great Royal Wife of Pharaoh Akhenaten.",
    significance: "The bust is celebrated for its refined modelling, balanced features, and surviving pigments.",
    facts: ["Associated with the workshop of the sculptor Thutmose", "Discovered in 1912 at Amarna"],
    card_uid: import.meta.env.VITE_RFID_UID_NEFERTITI || ""
  },
  {
    id: "churchfont",
    name: "Carved Stone Font",
    period: "Christian Medieval · Reference Exhibit",
    date: "Date not established from project asset",
    origin: "St Etheldreda’s Church",
    civilization: "Medieval European reference",
    material: "Carved stone",
    intro: "The third available project model is titled St Etheldreda’s Church Font.",
    significance: "This reference exhibit is identified by its supplied 3D model rather than represented as an Egyptian artifact.",
    facts: ["Loaded from the existing project GLB asset", "Model filename identifies it as a church font"],
    card_uid: import.meta.env.VITE_RFID_UID_CHURCHFONT || ""
  }
];

export default artifacts;
