import type { Human } from "../../../app/data/humans.server";
import type { SeedTable, SeedRecord } from "../index";

type HumanSeed = SeedRecord<Human>;

export const humansSeed: SeedTable<Human> = {
  table: "humans",
  records: [
    {
      id: "super_1",
      name: "Gerald L",
      email: "gerald@nopal.build",
      role: "Super",
    },
    {
      id: "admin_1",
      name: "Austin T",
      email: "austin@nopal.build",
      role: "Admin",
    },
    {
      id: "admin_2",
      name: "Lucas J",
      email: "lucas@nopal.build",
      role: "Admin",
    },
    {
      id: "admin_3",
      name: "James W",
      email: "james@nopal.build",
      role: "Admin",
    },
    {
      id: "admin_4",
      name: "Cam W",
      email: "cam@nopal.build",
      role: "Human",
    },
    {
      id: "human_1",
      name: "Harmony Willow",
      email: "harmony.willow@gmail.com",
      role: "Human",
    },
    {
      id: "human_2",
      name: "Clara Optimist",
      email: "clara.optimist@gmail.com",
      role: "Human",
    },
    {
      id: "human_3",
      name: "Susan Brittle",
      email: "susan.brittle@gmail.com",
      role: "Human",
    },
  ] satisfies HumanSeed[],
};
