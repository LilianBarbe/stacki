import React, { useEffect, useState } from 'react';
import type { Result } from '../../shared/result';
import { readHistoryFiles, readHistoryWorktrees } from '../historyBridge';
export { dayGroup, relativeTime, summarize } from '../historyModel';
import { HistoryBranches, HistoryFiles, HistorySection, HistoryWorktrees } from './HistorySections';
import HistoryTimeline from './HistoryTimeline';
import type { HistoryOpen, HistoryPanelProps } from './historyPanelTypes';

const INITIAL_OPEN: HistoryOpen = {
  timeline: true,
  files: false,
  branches: false,
  worktrees: false,
};

export default function HistoryPanel(props: HistoryPanelProps) {
  const [open, setOpen] = useState<HistoryOpen>(INITIAL_OPEN);
  const projectPath = props.project?.path;
  const branch = props.gitInfo?.isRepo ? props.gitInfo.branch : undefined;
  const head = props.gitInfo?.isRepo ? props.gitInfo.head : undefined;
  const dirty = props.gitInfo?.isRepo ? props.gitInfo.dirty : false;
  const files = useInventory(
    projectPath,
    open.files,
    `${branch}:${head}:${dirty}`,
    readHistoryFiles,
  );
  const worktrees = useInventory(projectPath, open.worktrees, branch, readHistoryWorktrees);
  const toggle = (key: keyof HistoryOpen): void => {
    setOpen((previous) => ({ ...previous, [key]: !previous[key] }));
  };

  if (!props.project) {
    return null;
  }
  if (props.gitInfo && !props.gitInfo.isRepo) {
    return <HistoryUnavailable />;
  }
  const userEmail = props.gitInfo?.isRepo ? props.gitInfo.userEmail : undefined;
  return (
    <div className="panel-section grow">
      <div className="panel-header">
        <h2>History</h2>
      </div>
      <div className="panel-body history-body">
        {props.previewRef && (
          <button className="history-exit-preview" onClick={props.onExitPreview}>
            Back to now
          </button>
        )}
        <HistorySection title="Timeline" open={open.timeline} onToggle={() => toggle('timeline')}>
          <HistoryTimeline
            projectPath={props.project.path}
            branch={branch}
            head={head}
            userEmail={userEmail}
            previewRef={props.previewRef}
            onPreviewCommit={props.onPreviewCommit}
            onExitPreview={props.onExitPreview}
            onRestoreFile={props.onRestoreFile}
            onRestoreProject={props.onRestoreProject}
          />
        </HistorySection>
        <HistoryFiles
          files={files}
          open={open.files}
          toggle={() => toggle('files')}
          onOpen={props.onOpenFile}
        />
        <HistoryBranches
          gitInfo={props.gitInfo}
          open={open.branches}
          toggle={() => toggle('branches')}
          onSwitch={props.onSwitchBranch}
          onMerge={props.onMergeBranch}
          onDelete={props.onDeleteBranch}
        />
        <HistoryWorktrees
          worktrees={worktrees}
          open={open.worktrees}
          toggle={() => toggle('worktrees')}
        />
      </div>
    </div>
  );
}

function useInventory<Value>(
  projectPath: string | undefined,
  enabled: boolean,
  revision: unknown,
  read: (path: string) => Promise<Result<readonly Value[], string>>,
): readonly Value[] {
  const [values, setValues] = useState<readonly Value[]>([]);
  useEffect(() => {
    let active = true;
    if (!projectPath || !enabled) {
      return () => {
        active = false;
      };
    }
    void read(projectPath).then((result) => {
      if (active) {
        setValues(result.ok ? result.value : []);
      }
    });
    return () => {
      active = false;
    };
  }, [enabled, projectPath, read, revision]);
  return values;
}

function HistoryUnavailable() {
  return (
    <div className="panel-section grow">
      <div className="panel-header">
        <h2>History</h2>
      </div>
      <div className="panel-body">
        <p className="history-empty">
          This project isn’t tracking its history yet. Turn it on from the branch button in the
          title bar and every save from then on can be gone back to.
        </p>
      </div>
    </div>
  );
}
