import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export class FileWatcherService {
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private lastChangeTime = 0;
  private readonly DEBOUNCE_DELAY = 500; // ms - wait for rapid file writes to complete
  private readonly MIN_CHANGE_INTERVAL = 1000; // ms - prevent excessive updates
  private isWatching = false;

  /**
   * Start watching Claude usage files for changes
   */
  startWatching(callback: () => void): boolean {
    if (this.isWatching) {
      console.warn('FileWatcher: Already watching files');
      return true;
    }

    try {
      const claudePath = path.join(os.homedir(), '.claude');
      const projectsPath = path.join(claudePath, 'projects');

      // Verify the Claude directory exists
      if (!fs.existsSync(claudePath)) {
        console.error('FileWatcher: Claude directory not found at', claudePath);
        return false;
      }

      if (!fs.existsSync(projectsPath)) {
        console.error('FileWatcher: Projects directory not found at', projectsPath);
        return false;
      }

      // Watch the projects directory where JSONL usage files are written
      this.watcher = fs.watch(projectsPath, { recursive: true }, (eventType, filename) => {
        // Only react to JSONL file changes (usage data files)
        if (filename?.endsWith('.jsonl')) {
          console.log(`FileWatcher: Detected ${eventType} on ${filename}`);
          this.handleFileChange(callback);
        }
      });

      this.watcher.on('error', (error) => {
        console.error('FileWatcher: Error watching files:', error);
        this.stopWatching();
      });

      this.watcher.on('close', () => {
        console.log('FileWatcher: File watcher closed');
        this.isWatching = false;
      });

      this.isWatching = true;
      console.log('FileWatcher: Started watching', projectsPath);
      return true;
    } catch (error) {
      console.error('FileWatcher: Failed to start watching:', error);
      return false;
    }
  }

  /**
   * Stop watching files and clean up resources
   */
  stopWatching(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.isWatching = false;
    console.log('FileWatcher: Stopped watching files');
  }

  /**
   * Check if currently watching files
   */
  isCurrentlyWatching(): boolean {
    return this.isWatching;
  }

  /**
   * Handle file change events with debouncing and rate limiting
   */
  private handleFileChange(callback: () => void): void {
    const now = Date.now();

    // Clear any existing debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    // Debounce rapid file changes (Claude might write multiple files quickly)
    this.debounceTimer = setTimeout(() => {
      // Rate limit to prevent excessive updates
      if (now - this.lastChangeTime > this.MIN_CHANGE_INTERVAL) {
        this.lastChangeTime = now;
        console.log('FileWatcher: Triggering usage update');
        callback();
      } else {
        console.log('FileWatcher: Update rate limited');
      }
    }, this.DEBOUNCE_DELAY);
  }

  /**
   * Get statistics about the file watcher
   */
  getStats() {
    return {
      isWatching: this.isWatching,
      lastChangeTime: this.lastChangeTime,
      hasDebounceTimer: this.debounceTimer !== null,
    };
  }
}
