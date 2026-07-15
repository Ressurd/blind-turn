"use client";

import {
  CARD_CATALOG,
  CHARACTER_CATALOG,
  CHARACTER_CLASS_IDS,
  formatHp,
  type CardCategory,
} from "@blind-turn/shared";
import Link from "next/link";
import { useMemo, useState } from "react";

const CATEGORIES: Array<CardCategory | "ALL"> = [
  "ALL",
  "ATTACK",
  "GUARD",
  "EVADE",
  "COUNTER",
  "UTILITY",
];

export function GameSimulator() {
  const [category, setCategory] = useState<CardCategory | "ALL">("ALL");
  const cards = useMemo(
    () => Object.values(CARD_CATALOG).filter((card) =>
      category === "ALL" || card.category === category),
    [category],
  );
  return (
    <main className="appShell">
      <div className="ambientGrid" aria-hidden="true" />
      <header className="siteHeader">
        <div className="brandLockup"><span className="brandMark">BT</span><span className="brandWords"><strong>BLIND TURN</strong><small>V2 RULE LAB</small></span></div>
        <div className="headerMeta"><span className="liveDot" />DATA CATALOG</div>
        <Link className="ghostLink" href="/">온라인 대전</Link>
      </header>
      <section className="v2BattlePage">
        <div className="roomHero"><div><p className="eyebrow">RULESET V2</p><h1>전투 규칙 실험실</h1></div></div>
        <section className="characterSelect">
          <div className="panelTitle"><p className="eyebrow">CHARACTERS</p><h2>캐릭터 4종</h2></div>
          <div className="characterGrid">
            {CHARACTER_CLASS_IDS.map((id) => {
              const character = CHARACTER_CATALOG[id];
              return <article className="characterCard" key={id}><span>{id}</span><strong>{character.name}</strong><b>HP {formatHp(character.maxHp)}</b><p>{character.passive}</p><small>{character.playStyle}</small></article>;
            })}
          </div>
        </section>
        <section className="cardCommandPanel">
          <div className="panelTitle"><div><p className="eyebrow">DATA-DRIVEN CATALOG</p><h2>카드 {cards.length}장</h2></div></div>
          <div className="dialogActions" role="group" aria-label="카드 분류">
            {CATEGORIES.map((item) => <button key={item} className={category === item ? "primaryButton" : ""} onClick={() => setCategory(item)}>{item}</button>)}
          </div>
          <div className="v2CardGrid compact">
            {cards.map((card) => <article className={`v2Card card-${card.category.toLowerCase()}`} key={card.id}><span>{card.classId}</span><strong>{card.name}</strong><p>{card.description}</p><small>{card.id}</small></article>)}
          </div>
        </section>
      </section>
    </main>
  );
}
