import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ProjectsService } from './projects.service';
import { Project } from '../../models/schema';
//プロジェクト一覧画面
@Component({
  standalone: true,
  selector: 'app-projects-list',
  imports: [CommonModule, FormsModule],
  template: `
    <div class="max-w-3xl mx-auto p-4">
      <h1 class="text-xl font-bold mb-4">プロジェクト</h1>

      <form (ngSubmit)="onCreate()" class="grid gap-2 md:grid-cols-2 mb-6">
        <input
          name="name"
          [(ngModel)]="name"
          placeholder="名称（必須）"
          required
          class="border p-2 rounded"
        />
        <input
          name="goal"
          [(ngModel)]="goal"
          placeholder="達成目標（任意）"
          class="border p-2 rounded"
        />
        <textarea
          name="desc"
          [(ngModel)]="description"
          placeholder="説明（任意）"
          class="border p-2 rounded md:col-span-2"
        ></textarea>
        <div class="flex gap-2 md:col-span-2">
          <button class="border rounded px-3 py-2" [disabled]="loading()">
            作成
          </button>
        </div>
      </form>

      <div *ngIf="projects().length === 0" class="opacity-70">
        まだプロジェクトがありません。
      </div>

      <ul class="divide-y">
        <li *ngFor="let p of projects()" class="py-3 flex items-center gap-3">
          <div class="font-medium">{{ p.name }}</div>
          <div class="text-sm opacity-70">
            メンバー: {{ p.memberIds.length || 1 }}
          </div>
          <button class="ml-auto text-sm underline" (click)="toggleArchive(p)">
            {{ p.archived ? '復元' : 'アーカイブ' }}
          </button>
        </li>
      </ul>
    </div>
  `,
})
export class ProjectsListComponent implements OnInit {
  private svc = inject(ProjectsService);
  projects = signal<Project[]>([]);
  loading = signal(false);

  name = '';
  goal = '';
  description = '';

  async ngOnInit() {
    console.log('●●●ngOnInit started');
    await this.refresh();
    console.log('●●●ngOnInit completed');
  }

  async refresh() {
    console.log('●●●refresh started');
    const projects = await this.svc.listMyProjects();
    console.log('●●●Projects received:', projects);
    this.projects.set(projects);
  }

  async onCreate() {
    console.log('●●●onCreate called, name:', this.name);
    this.loading.set(true);
    try {
      const projectId = await this.svc.createProject({
        name: this.name,
        description: this.description,
        goal: this.goal,
      });
      console.log('●●●Project created with ID:', projectId);
      this.name = '';
      this.description = '';
      this.goal = '';
      await this.refresh();
    } catch (error) {
      console.error('●●●Error creating project:', error);
    } finally {
      this.loading.set(false);
    }
  }

  async toggleArchive(p: Project) {
    if (!p.id) return;
    await this.svc.archive(p.id, !(p.archived ?? false));
    await this.refresh();
  }
}
