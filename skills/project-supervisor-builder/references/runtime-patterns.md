# 运行模式

先复用项目已有能力，再补最小缺口。目标不是建立监控平台，而是用最少常驻组件让任务持续推进到完成。

## 选择顺序

### A. 已有任务系统与状态接口

适用：Slurm、云训练 Job、项目已有 `status --json`、CI、队列系统。

做法：

1. 直接调用已有只读状态接口。
2. 映射为少量通用状态。
3. 复用已有 retry/resume，只补事件门控、Agent 接管、Pi-Web 唤醒和项目策略。

不要再用 `ps` 或解析整份日志建立第二套真源。

### B. 后台任务可靠，但状态分散

适用：任务已由 `tmux`、`systemd` 或项目 runner 保持存活。

probe 组合以下事实：

- 进程/job 是否存在；
- 退出码或服务状态；
- 日志/heartbeat 最后更新时间；
- 进度是否变化；
- checkpoint/最终产物是否存在且可读取。

不要仅凭进程消失判成功，也不要把一次 SSH 失败判任务失败。

### C. 只有裸命令

先让命令脱离 SSH：优先项目已有方式，其次用户级 `systemd`，简单临时任务可用 `tmux`。启动层至少保存 run ID、命令、开始时间、PID/job ID、日志和退出结果，并使用 fail-fast 控制流，防止前一阶段失败后盲目进入下一阶段。

监督脚本不应自己长期持有 SSH 连接。

## Probe 边界

probe 只观察，不恢复、不通知、不调用模型。输出使用项目可稳定生成的结构化格式，例如：

```json
{
  "version": 1,
  "run_id": "factor-model-v3-20260711-01",
  "observed_at": "2026-07-11T03:42:18Z",
  "state": "running",
  "summary": "step 42000/100000, loss 0.284",
  "progress_key": "42000",
  "fingerprint": "running:42000",
  "evidence": {
    "log_mtime": "2026-07-11T03:41:58Z",
    "checkpoint": "step-40000.pt"
  }
}
```

通用状态保持少量：

```text
created | running | needs_attention | waiting_confirmation | completed | stopped | unknown
```

项目可保留更细事实，但不要把业务状态全集做成全局 schema。

## 完成导向控制循环

```text
runner 处理确定性瞬时错误
  ↓ 仍异常、里程碑或完成
probe/tick 生成稳定事件
  ↓
Pi-Web 监工 Agent 诊断
  ├─ 在自治范围内修复/恢复 → 验证进度 → 回到静默观察
  ├─ 验证任务完成 → 同步/校验产物 → 资源收尾 → 完成报告
  └─ 越过语义、不可逆或预算边界 → 保留现场 → 升级用户
```

Agent 对事件持续负责。HTTP 投递成功、写出诊断或执行了命令都不等于解决；只有观察到恢复后的进度、完成产物或明确升级回执才结束事件。

恢复分两类：

- **固定恢复**：resume、restart、重连、重建任务管理器等，使用幂等 action ID。
- **适应性修复**：异常未预先枚举，但可在授权范围内通过工程判断解决。使用隔离 worktree/临时环境、回退点、测试门禁和自治预算，不要求事先列出每条 shell 命令。

业务/研究定义、正式数据、不可逆操作、权限边界和超预算不属于适应性修复。

## Tick 算法

```text
acquire non-blocking lock
run probe with timeout
write observation atomically
compare with last observation and policy
if normal and no milestone: exit
derive stable event ID
create immutable event if absent
if terminal receipt exists: exit
if last submission is inside cooldown: exit
submit event to Pi-Web and append attempt
exit
```

要求：

- 同一 tick 使用 `flock` 或平台等价能力，防止调度重叠。
- 文件在同一文件系统内先写临时名，再 `rename`。
- 所有命令使用明确超时和绝对路径。
- shell 中引用变量，不用 `eval`，不把日志内容拼进命令。
- 大输出写证据文件，事件仅带摘要和路径。
- event ID 由 run ID、事件类型和首次观察时间等稳定事实生成。
- 投递尝试使用 append-only 日志或 tick 单写文件，Agent 不修改它。

## systemd User Timer

在 Linux 常开机器上优先用户级 systemd。生成前检查系统版本、Pi-Web 服务用户、项目绝对路径，以及退出登录后 user manager 是否继续运行；需要 `loginctl enable-linger` 时说明影响并等待确认。

典型 service：

```ini
[Unit]
Description=Project supervisor tick: <project>

[Service]
Type=oneshot
WorkingDirectory=<absolute-project-path>
ExecStart=<absolute-project-path>/.pi/supervisor/tick.sh
```

典型 timer：

```ini
[Unit]
Description=Project supervisor schedule: <project>

[Timer]
OnBootSec=2min
OnUnitActiveSec=10min
Persistent=true
Unit=<unit-name>.service

[Install]
WantedBy=timers.target
```

文件名带项目路径哈希或稳定短 ID，避免同名项目冲突。README 记录实际 unit 名及：

```bash
systemctl --user status <unit>.timer
systemctl --user stop <unit>.timer
systemctl --user start <unit>.timer
systemctl --user disable --now <unit>.timer
journalctl --user -u <unit>.service
```

不要自动删除运行产物、事件、回执或 pi session。

## Cron Fallback

只有没有合适 systemd/已有调度器时才用 cron。安装带唯一注释标记的一行，使用绝对路径和文件锁；卸载仅删除自己的标记行，不重写其他 cron 条目。

## 自主动作与恢复

### 确定性动作

resume、restart、电源和部署等入口必须：

1. 接收稳定 `action_id` 和 run/job/resource ID；
2. 重复调用返回原结果，不再次执行；
3. 参数来自 policy/runtime binding，不接受日志提供的命令；
4. 动作前后状态、请求 ID 和验证结果持久化；
5. 有次数、时间和成本上限；
6. 动作成功后继续观察，直到进度或产物证明恢复。

### Agent 适应性修复

无法用固定动作覆盖的小问题，不必一律交还用户。项目授权后，Agent 可以：

- 在指定主机和路径内检查、修改环境或代码；
- 为代码修改创建隔离 worktree/run branch，避免与主 session 并发覆盖；
- 运行项目已有测试、smoke 或数据一致性门禁；
- 通过后部署并恢复同一 run，失败则回退；
- 在 action journal 中记录假设、修改、验证、耗时和剩余尝试次数。

达到任一边界即升级：验证无法证明安全、连续修复失败、需要改变任务含义、需要删除/覆盖正式数据、扩大权限或超过费用/时间预算。

仅在事件回执层标记 `resolved` 不能保证动作幂等：动作成功但回执写入前崩溃时仍会重投。固定动作自身必须幂等；适应性修复必须能从 journal 和工作区判断上次做到哪里。

### 收费资源生命周期

控制云主机、队列或按量资源时，把资源 ID、开机授权、最大时长/费用、结果同步和关机条件写入契约：

- 用户下达本次任务可同时授予一次开机和有限次数恢复开机；
- 完成后先验证并同步产物，再自动关机；
- 严重失败时先保存 checkpoint/证据，再按策略关机，避免无人在线时持续计费；
- `release/delete` 与 `power-off/stop` 分开，前者默认不自动；
- 电源 API 不可用时可使用平台官方的实例内关机入口，但需说明无法从关机状态自动开机；
- 设置确定性的最长运行时间作为模型、网络或 Pi-Web 同时失效时的费用保险。

费用边界必须落成可执行限制，而不是只写一个金额：优先读取供应商的可靠计费/额度接口；没有接口时，按已知最高单价和预留余量把金额换算成绝对停止时间、最大动作次数或模型调用额度。journal 分开记录已确认费用和保守估算，下一动作的最坏成本会越界时不启动并升级。无法精确计费不阻塞不增加费用的监督与恢复；只禁用对应增费动作，或请用户改用可硬执行的时长/次数上限，不为此搭通用账单系统。

## 最小验证

- probe 对真实运行中、完成、失败、SSH 不可达各试一次或用 fixture 模拟。
- 连续两次正常 tick 不生成新事件。
- 同一异常重复观察只对应一个 event ID。
- tick 并发启动时只有一个获得锁。
- 对每类已启用恢复能力验证一个代表动作；终止一个可恢复任务，确认 Agent 自动恢复且进度继续，同 action ID 重投不重复执行。
- 若启用适应性修复，用现有测试或最小 fixture 确认修改经过隔离、测试、部署和回退门禁。
- 触发硬边界，确认不改任务含义并生成完整升级回执。
- 模拟完成；若启用产物同步或资源动作，确认相应收尾只发生一次。
- disable timer 后不再检查；手工执行 probe 仍可用。
