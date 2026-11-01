import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const migration = readFileSync(new URL(
  "../supabase/migrations/20260924172944_session_identity_colors.sql",
  import.meta.url,
), "utf8");

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create table public.classes (
      id text primary key,
      name text not null
    );
    create table public.sessions (
      id text primary key,
      class_id text not null references public.classes(id)
    );
    insert into public.classes (id, name) values ('historical-class', 'Histórica');
    insert into public.sessions (id, class_id) values ('historical-session', 'historical-class');
  `);
  await db.exec(migration);
});

afterAll(async () => db.close());

describe("session identity and academic colors migration", () => {
  it("preserves historical rows with blue and a nullable session name", async () => {
    expect((await db.query("select color_key from public.classes where id='historical-class'")).rows)
      .toEqual([{ color_key: "blue" }]);
    expect((await db.query("select session_name,color_key from public.sessions where id='historical-session'")).rows)
      .toEqual([{ session_name: null, color_key: "blue" }]);
  });

  it("persists every controlled class and session color", async () => {
    const colors = ["blue", "navy", "cyan", "green", "amber", "red", "purple", "slate"];
    for (const [index, color] of colors.entries()) {
      await db.query("insert into public.classes(id,name,color_key) values($1,$2,$3)", [`class-${index}`, color, color]);
      await db.query("insert into public.sessions(id,class_id,session_name,color_key) values($1,$2,$3,$4)", [`session-${index}`, `class-${index}`, `Sesión ${color}`, color]);
    }
    expect((await db.query("select color_key from public.classes where id='class-6'")).rows).toEqual([{ color_key: "purple" }]);
    expect((await db.query("select session_name,color_key from public.sessions where id='session-2'")).rows).toEqual([{ session_name: "Sesión cyan", color_key: "cyan" }]);
  });

  it("rejects arbitrary colors and invalid session names", async () => {
    await expect(db.query("insert into public.classes(id,name,color_key) values('bad-class','Bad','#ff00ff')"))
      .rejects.toMatchObject({ constraint: "classes_color_key_allowed" });
    await expect(db.query("insert into public.sessions(id,class_id,color_key) values('bad-session','historical-class','orange')"))
      .rejects.toMatchObject({ constraint: "sessions_color_key_allowed" });
    await expect(db.query("insert into public.sessions(id,class_id,session_name) values('blank-session','historical-class','   ')"))
      .rejects.toMatchObject({ constraint: "sessions_name_length" });
    await expect(db.query("insert into public.sessions(id,class_id,session_name) values('long-session','historical-class',$1)", ["x".repeat(121)]))
      .rejects.toMatchObject({ constraint: "sessions_name_length" });
  });
});
