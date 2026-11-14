import * as THREE from 'three';
import {
  SPECIES_CONFIGS,
  SPECIES_ORDER,
  getSpeciesTitleRu,
} from '../entities/SpeciesData';
import type { Animal, SeasonState, SpeciesId, TimeState, WorldEvent } from '../types';

export interface HUDCallbacks {
  onSpeedChange: (speed: number) => void;
  onToggleDirector: () => void;
  onToggleAudio: () => void;
  onCloseInspector: () => void;
  onEventClick: (pos: THREE.Vector3) => void;
  onSpeciesPick: (species: SpeciesId) => void;
}

export class HUD {
  private readonly hudEl = document.getElementById('hud')!;
  private readonly timeDotEl = document.getElementById('time-dot')!;
  private readonly clockEl = document.getElementById('clock-display')!;
  private readonly seasonIconEl = document.getElementById('season-icon')!;
  private readonly seasonLabelEl = document.getElementById('season-label')!;
  private readonly weatherLabelEl = document.getElementById('weather-label')!;
  private readonly popToggleEl = document.getElementById('pop-toggle')!;
  private readonly popTotalEl = document.getElementById('pop-total')!;
  private readonly popDrawerEl = document.getElementById('pop-drawer')!;
  private readonly dayCounterEl = document.getElementById('day-counter')!;
  private readonly speciesGridEl = document.getElementById('species-grid')!;

  private readonly speedBtns = Array.from(
    document.querySelectorAll<HTMLButtonElement>('.speed-pill .icon-btn')
  );
  private readonly directorBtn = document.getElementById('director-btn') as HTMLButtonElement;
  private readonly audioBtn = document.getElementById('audio-btn') as HTMLButtonElement;
  private readonly hideHudBtn = document.getElementById('hide-hud-btn') as HTMLButtonElement;
  private readonly showHudBtn = document.getElementById('show-hud-btn') as HTMLButtonElement;

  private readonly inspectorCard = document.getElementById('inspector-card')!;
  private readonly inspEmoji = document.getElementById('insp-emoji')!;
  private readonly inspName = document.getElementById('insp-name')!;
  private readonly inspMeta = document.getElementById('insp-meta')!;
  private readonly inspState = document.getElementById('insp-state')!;
  private readonly inspBiome = document.getElementById('insp-biome')!;
  private readonly inspBio = document.getElementById('insp-bio')!;
  private readonly barHunger = document.getElementById('bar-hunger')!;
  private readonly barThirst = document.getElementById('bar-thirst')!;
  private readonly barEnergy = document.getElementById('bar-energy')!;
  private readonly barHealth = document.getElementById('bar-health')!;
  private readonly inspClose = document.getElementById('insp-close')!;

  private readonly tickerEl = document.getElementById('event-ticker')!;

  private cinemaHidden = false;
  private shownEventIds = new Set<number>();
  private callbacks: HUDCallbacks;

  constructor(callbacks: HUDCallbacks) {
    this.callbacks = callbacks;
    this.bindEvents();
  }

  private bindEvents(): void {
    this.speedBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const spd = Number(btn.dataset.speed ?? '1');
        this.setActiveSpeed(spd);
        this.callbacks.onSpeedChange(spd);
      });
    });

    this.popToggleEl.addEventListener('click', () => {
      this.popDrawerEl.classList.toggle('hidden');
    });

    this.directorBtn.addEventListener('click', () => {
      this.callbacks.onToggleDirector();
    });

    this.audioBtn.addEventListener('click', () => {
      this.callbacks.onToggleAudio();
    });

    this.hideHudBtn.addEventListener('click', () => this.setCinemaMode(true));
    this.showHudBtn.addEventListener('click', () => this.setCinemaMode(false));
    this.inspClose.addEventListener('click', () => this.callbacks.onCloseInspector());

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyH') {
        this.setCinemaMode(!this.cinemaHidden);
      } else if (e.code === 'KeyD') {
        this.callbacks.onToggleDirector();
      } else if (e.code === 'KeyM') {
        this.callbacks.onToggleAudio();
      } else if (e.code === 'Escape') {
        this.callbacks.onCloseInspector();
      }
    });
  }

  public setCinemaMode(hidden: boolean): void {
    this.cinemaHidden = hidden;
    this.hudEl.classList.toggle('cinema-hidden', hidden);
    this.showHudBtn.classList.toggle('hidden', !hidden);
  }

  public setActiveSpeed(speed: number): void {
    this.speedBtns.forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.speed) === speed);
    });
  }

  public setDirectorActive(active: boolean): void {
    this.directorBtn.classList.toggle('active', active);
  }

  public setAudioActive(active: boolean): void {
    this.audioBtn.classList.toggle('active', active);
    this.audioBtn.innerHTML = active ? '🔊 <span>Звук</span>' : '🔇 <span>Звук</span>';
  }

  public update(
    time: TimeState,
    season: SeasonState,
    counts: Record<SpeciesId, number>,
    followedAnimal: Animal | null,
    biomeRu: string,
    events: WorldEvent[]
  ): void {
    const hh = String(time.hour).padStart(2, '0');
    const mm = String(time.minute).padStart(2, '0');
    this.clockEl.textContent = `${hh}:${mm} · ${time.phaseNameRu}`;

    const isNight = time.hour < 5 || time.hour >= 20;
    const isTwilight = (time.hour >= 5 && time.hour < 7) || (time.hour >= 18 && time.hour < 20);
    this.timeDotEl.style.background = isNight ? '#7aa4f4' : isTwilight ? '#f08a4b' : '#f3b552';
    this.timeDotEl.style.boxShadow = `0 0 10px ${this.timeDotEl.style.background}`;

    this.seasonIconEl.textContent = season.isRaining ? '🌧️' : season.isDrySeason ? '☀️' : '🌿';
    this.seasonLabelEl.textContent = season.seasonNameRu;
    this.weatherLabelEl.textContent = season.weatherTextRu;
    this.dayCounterEl.textContent = `День ${time.day}`;

    // Total & species breakdown
    let total = 0;
    for (const sp of SPECIES_ORDER) total += counts[sp] ?? 0;
    this.popTotalEl.textContent = `🐾 ${total}`;

    if (!this.popDrawerEl.classList.contains('hidden')) {
      this.renderSpeciesDrawer(counts);
    }

    // Inspector card
    if (followedAnimal && followedAnimal.alive) {
      this.inspectorCard.classList.remove('hidden');
      const cfg = SPECIES_CONFIGS[followedAnimal.species];
      const stageRu =
        followedAnimal.stage === 'juvenile'
          ? 'Детёныш'
          : followedAnimal.stage === 'elder'
            ? 'Пожилая особь'
            : followedAnimal.sex === 'M'
              ? 'Взрослый'
              : 'Взрослая';
      const ageLabel = `${followedAnimal.ageDays.toFixed(1)} дн.`;

      this.inspEmoji.textContent = cfg.emoji;
      this.inspName.textContent = followedAnimal.name;
      this.inspMeta.textContent = `${getSpeciesTitleRu(followedAnimal.species, followedAnimal.sex)} · ${stageRu} · ${ageLabel}`;
      this.inspState.textContent = followedAnimal.statusText;
      this.inspBiome.textContent = biomeRu;
      this.inspBio.textContent = cfg.bioRu;

      this.barHunger.style.width = `${Math.round(followedAnimal.hunger)}%`;
      this.barThirst.style.width = `${Math.round(followedAnimal.thirst)}%`;
      this.barEnergy.style.width = `${Math.round(followedAnimal.energy)}%`;
      this.barHealth.style.width = `${Math.round(followedAnimal.health)}%`;
    } else {
      this.inspectorCard.classList.add('hidden');
    }

    // Event Ticker
    this.syncEvents(events);
  }

  private renderSpeciesDrawer(counts: Record<SpeciesId, number>): void {
    this.speciesGridEl.innerHTML = '';
    for (const sp of SPECIES_ORDER) {
      const cfg = SPECIES_CONFIGS[sp];
      const row = document.createElement('div');
      row.className = 'species-row';
      row.title = `Найти в долине: ${cfg.pluralRu}`;
      row.innerHTML = `
        <span class="species-row-label"><span>${cfg.emoji}</span><span>${cfg.pluralRu}</span></span>
        <span class="species-row-count">${counts[sp] ?? 0}</span>
      `;
      row.addEventListener('click', () => this.callbacks.onSpeciesPick(sp));
      this.speciesGridEl.appendChild(row);
    }
  }

  private syncEvents(events: WorldEvent[]): void {
    const now = performance.now();
    // Show newest unseen events (max 3 visible)
    for (let i = Math.min(2, events.length - 1); i >= 0; i--) {
      const ev = events[i];
      if (this.shownEventIds.has(ev.id)) continue;
      if (now - ev.createdAtReal > 10000) continue;

      this.shownEventIds.add(ev.id);
      const toast = document.createElement('div');
      toast.className = 'event-toast';
      toast.textContent = `${ev.icon} ${ev.text}`;
      toast.addEventListener('click', () => this.callbacks.onEventClick(ev.pos));

      this.tickerEl.appendChild(toast);
      while (this.tickerEl.children.length > 3) {
        this.tickerEl.firstElementChild?.remove();
      }

      setTimeout(() => {
        toast.classList.add('fading');
        setTimeout(() => toast.remove(), 450);
      }, 9000);
    }
  }
}
