import { AdminNav } from './admin';
export const AddonsPage = () => (
  <section>
    <h1>Admin</h1>
    <AdminNav active="Addons" />
    <p class="sub">Addons the guild uses. Unzip into <code>World of Warcraft\_forever_\Interface\AddOns\</code> and type <code>/reload</code>.</p>
    <div class="card">
      <h3>Guild Pulse</h3>
      <p style="margin-top:0">
        Keeps track of the guild roster: everyone's level, when they were last online, how many levels they gained in the
        last 7 days, how much time they were seen online, and how much of it was spent in dungeons and raids. Handy for
        checking that raiders are still levelling and gearing outside raids.
        Type <code>/gpulse</code> to open it. Click a column to sort, use the Rank button to show only Raiders, and click a
        member in the Guild window to see their stats under the member details. Paste{' '}
        <b>Export for site</b> into the <a href="/admin/roster">Roster</a> page.
      </p>
      <p class="alt">
        Everyone running Guild Pulse shares what they see over a hidden guild addon channel, so the more people use it,
        the more complete the playtime gets. Dungeon time is read from the guild roster's zone column; dungeons Guild Pulse
        does not know yet are learned when a Guild Pulse user is inside one. Playtime only counts while at least one Guild Pulse user is online, and levels
        gained show <code>~</code> until the addon has a week of history.
      </p>
      <p><a class="dl" href="/officer/GuildPulse.zip" download>Download Guild Pulse (zip)</a></p>
      <img class="shot" src="/officer/guildpulse.webp" width="965" height="664" alt="The Guild Pulse window listing guild members with level, rank, last online and playtime" loading="lazy" />
    </div>
    <div class="card">
      <h3>LimpusAttendance</h3>
      <p style="margin-top:0">Records who was in the raid at each boss kill. Only the officer recording attendance needs it.</p>
      <p><a class="dl" href="https://github.com/Amoeslund/limpus-dinkus/releases/latest">Download from the latest release</a></p>
    </div>
  </section>
);
