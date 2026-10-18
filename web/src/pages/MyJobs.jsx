import { HardHat } from 'lucide-react';
import { addDays } from '@core/util.js';
import { useData } from '../lib/data.js';
import { useSession } from '../lib/session.jsx';
import { todayStr, dateLong, relDay } from '../lib/format.js';
import { Screen } from '../ui/Shell.jsx';
import { Panel, Loading, ErrorNote, Empty } from '../ui/kit.jsx';
import { ApptRow } from './Home.jsx';

export default function MyJobs() {
  const { user } = useSession();
  const today = todayStr();
  const upcoming = useData('/appointments', { from: today, to: addDays(today, 21) });
  const recent = useData('/appointments', { from: addDays(today, -7), to: addDays(today, -1) });
  const open = (upcoming.data || []).filter((a) => a.status !== 'done');
  const byDay = {};
  for (const a of open) (byDay[a.date] ||= []).push(a);
  const done = [...(recent.data || []), ...(upcoming.data || [])].filter((a) => a.status === 'done').reverse();
  return (
    <Screen title="My jobs">
      <div className="page-head">
        <div>
          <h1>Hi, {user?.name?.split(' ')[0]}</h1>
          <div className="page-sub">{dateLong(today)}</div>
        </div>
      </div>
      <ErrorNote error={upcoming.error} retry={upcoming.reload} />
      {upcoming.loading && !upcoming.data ? <Loading /> : (
        Object.keys(byDay).length ? (
          <div className="panel rows">
            {Object.entries(byDay).map(([day, list]) => (
              <div key={day} className="rows">
                <div className="day-head">{relDay(day, today)}<span className="faint">{dateLong(day)}</span></div>
                {list.map((a) => <ApptRow key={a.id} a={a} today={today} jobLink />)}
              </div>
            ))}
          </div>
        ) : (
          <Panel><Empty icon={HardHat} title="No jobs scheduled">When the office assigns you a job, it shows up here with the address, rooms and materials.</Empty></Panel>
        )
      )}
      {done.length > 0 && (
        <Panel title="Finished this week">
          <div className="rows">{done.map((a) => <ApptRow key={a.id} a={a} today={today} showDate jobLink />)}</div>
        </Panel>
      )}
    </Screen>
  );
}
